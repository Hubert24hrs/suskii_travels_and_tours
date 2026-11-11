import { createHash } from 'node:crypto';

import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  KNOWLEDGE_MAX_BYTES,
  KNOWLEDGE_MAX_DOCUMENTS,
  KNOWLEDGE_MAX_PASSAGES,
  KNOWLEDGE_MEDIA_TYPES,
  KNOWLEDGE_SEARCH_CONFIG,
  knowledgePassages,
  looksLikeText,
  type KnowledgeAudience,
  type KnowledgeLanguage,
  type KnowledgeMediaType,
} from '@suskii/shared';

import { conflict, fieldChanges, hasChanges, type StaffActor } from '../../admin/admin-helpers';
import { AuditService } from '../../audit/audit.service';
import { ProblemDetailsException } from '../../common/problem-details';
import { uuidv7 } from '../../common/uuid';
import { ObjectStorage } from '../../documents/object-storage';
import { Prisma, type KnowledgeDocument } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { AntivirusScanner, ScanFailedError } from '../../visa/antivirus';

import type {
  KnowledgeDocumentDetail,
  KnowledgeDocumentDto,
  KnowledgeHit,
  KnowledgePatch,
  KnowledgeUpload,
} from './knowledge.schemas';

/** Passages written per statement. */
const INSERT_BATCH = 100;
/** Passages returned for one question. */
export const KNOWLEDGE_HITS = 4;

const refused = (
  status: HttpStatus,
  slug: string,
  title: string,
  detail?: string,
): ProblemDetailsException => new ProblemDetailsException(status, slug, title, detail);

export const knowledgeTooLarge = (maxBytes: number): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.PAYLOAD_TOO_LARGE,
    'document-too-large',
    'This file is too large',
    `Upload a file of at most ${Math.floor(maxBytes / 1024)} KB.`,
    { maxBytes },
  );

export const knowledgeWrongType = (): ProblemDetailsException =>
  refused(
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    'document-type',
    'This file type is not accepted',
    'Upload plain text or Markdown.',
  );

const dto = (row: KnowledgeDocument): KnowledgeDocumentDto => ({
  id: row.id,
  title: row.title,
  audience: row.audience as KnowledgeAudience,
  language: row.language as KnowledgeLanguage,
  mediaType: row.mediaType as KnowledgeMediaType,
  sizeBytes: row.sizeBytes,
  passages: row.chunkCount,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * The assistant's knowledge base (ADR-105): documents staff upload, kept as passages and found
 * with PostgreSQL full-text search. A document is plain text or Markdown, virus-scanned before
 * it counts, and company text only. Passages are the document's own words: nothing here
 * rewrites, summarises or ranks with a model. An archived document is never searched; nothing
 * is deleted, so what the assistant could have answered from at a time can be shown.
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: ObjectStorage,
    private readonly scanner: AntivirusScanner,
  ) {}

  async list(archived: boolean): Promise<{
    items: KnowledgeDocumentDto[];
    inUse: number;
    limit: number;
    maxBytes: number;
  }> {
    const [rows, inUse] = await Promise.all([
      this.prisma.knowledgeDocument.findMany({
        where: { archivedAt: archived ? { not: null } : null },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 500,
      }),
      this.prisma.knowledgeDocument.count({ where: { archivedAt: null } }),
    ]);
    return {
      items: rows.map(dto),
      inUse,
      limit: KNOWLEDGE_MAX_DOCUMENTS,
      maxBytes: KNOWLEDGE_MAX_BYTES,
    };
  }

  async get(id: string): Promise<KnowledgeDocumentDetail> {
    const row = await this.prisma.knowledgeDocument.findUnique({
      where: { id },
      include: {
        chunks: {
          orderBy: { position: 'asc' },
          select: { id: true, position: true, heading: true, body: true },
        },
      },
    });
    if (!row) throw new NotFoundException();
    return { document: dto(row), passages: row.chunks };
  }

  /** The file as it was uploaded. */
  async content(id: string): Promise<{ bytes: Buffer; contentType: string; name: string }> {
    const row = await this.prisma.knowledgeDocument.findUnique({ where: { id } });
    const bytes = row ? await this.storage.get(row.storageKey) : null;
    if (!row || !bytes) throw new NotFoundException();
    return {
      bytes,
      contentType: `${row.mediaType}; charset=utf-8`,
      name: `knowledge-${row.id}.${row.mediaType === 'text/markdown' ? 'md' : 'txt'}`,
    };
  }

  /**
   * Adds a document: the bytes must be text (checked on the bytes, whatever type was
   * declared), pass the virus scan and hold something to read. The file goes to object storage
   * first and the rows are written in one transaction; a failure removes the file again.
   */
  async add(
    meta: KnowledgeUpload,
    mediaType: string,
    bytes: Buffer,
    staff: StaffActor,
  ): Promise<KnowledgeDocumentDto> {
    if (!(KNOWLEDGE_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
      throw knowledgeWrongType();
    }
    if (bytes.byteLength === 0) throw knowledgeWrongType();
    if (bytes.byteLength > KNOWLEDGE_MAX_BYTES) throw knowledgeTooLarge(KNOWLEDGE_MAX_BYTES);
    const text = new TextDecoder('utf-8').decode(bytes);
    if (!looksLikeText(text)) throw knowledgeWrongType();
    await this.assertClean(bytes);

    const passages = knowledgePassages(text);
    if (passages.length === 0) {
      throw refused(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'knowledge-empty',
        'There is nothing to read in this file',
      );
    }
    if (passages.length > KNOWLEDGE_MAX_PASSAGES) {
      throw refused(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'knowledge-too-long',
        'This document is too long',
        'Split it into smaller documents by subject.',
      );
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const id = uuidv7();
    const storageKey = `knowledge/${id}.txt`;
    const config = KNOWLEDGE_SEARCH_CONFIG[meta.language];
    await this.storage.put(storageKey, bytes, `${mediaType}; charset=utf-8`);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // One writer at a time, so the count and the duplicate check hold.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('knowledge-documents'))`;
        const [inUse, same] = await Promise.all([
          tx.knowledgeDocument.count({ where: { archivedAt: null } }),
          tx.knowledgeDocument.findFirst({
            where: { sha256, archivedAt: null, audience: meta.audience, language: meta.language },
            select: { id: true },
          }),
        ]);
        if (same) {
          throw conflict('knowledge-duplicate', 'This document is already in the knowledge base');
        }
        if (inUse >= KNOWLEDGE_MAX_DOCUMENTS) {
          throw conflict('knowledge-full', 'The knowledge base is full; archive a document first');
        }
        const row = await tx.knowledgeDocument.create({
          data: {
            id,
            title: meta.title,
            audience: meta.audience,
            language: meta.language,
            mediaType,
            sizeBytes: bytes.byteLength,
            sha256,
            storageKey,
            chunkCount: passages.length,
          },
        });
        for (let start = 0; start < passages.length; start += INSERT_BATCH) {
          const values = passages.slice(start, start + INSERT_BATCH).map(
            (passage, offset) =>
              // The heading weighs more than the body: a passage under "Refunds" answers a
              // question about refunds before one that mentions them in passing.
              Prisma.sql`(${uuidv7()}::uuid, ${id}::uuid, ${start + offset}, ${passage.heading}, ${passage.body},
                setweight(to_tsvector(${config}::regconfig, ${passage.heading ?? ''}), 'A') ||
                setweight(to_tsvector(${config}::regconfig, ${passage.body}), 'B'))`,
          );
          await tx.$executeRaw`
            INSERT INTO knowledge_chunks (id, document_id, position, heading, body, search)
            VALUES ${Prisma.join(values)}`;
        }
        await this.audit.record(
          {
            action: 'agent.knowledge_added',
            actorUserId: staff.userId,
            targetType: 'knowledge_document',
            targetId: id,
            metadata: {
              audience: meta.audience,
              language: meta.language,
              passages: passages.length,
              sizeBytes: bytes.byteLength,
            },
            context: staff.context,
          },
          tx,
        );
        return dto(row);
      });
    } catch (error) {
      await this.storage.delete(storageKey).catch((failure: unknown) => {
        this.logger.warn({ msg: 'knowledge file not removed', reason: (failure as Error).name });
      });
      throw error;
    }
  }

  async change(
    id: string,
    patch: KnowledgePatch,
    staff: StaffActor,
  ): Promise<KnowledgeDocumentDto> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.knowledgeDocument.findUnique({ where: { id } });
      if (!current) throw new NotFoundException();
      const before = { title: current.title, audience: current.audience };
      const after = { ...before, ...patch };
      // The title is free text: the audit names the field, not its words.
      const changes = fieldChanges(before, after, ['title']);
      if (!hasChanges(changes)) return dto(current);
      const row = await tx.knowledgeDocument.update({ where: { id }, data: after });
      await this.audit.record(
        {
          action: 'agent.knowledge_changed',
          actorUserId: staff.userId,
          targetType: 'knowledge_document',
          targetId: id,
          metadata: { changes },
          context: staff.context,
        },
        tx,
      );
      return dto(row);
    });
  }

  /** Takes a document out of use, or puts it back. A conditional update claims the change. */
  async setArchived(
    id: string,
    archived: boolean,
    staff: StaffActor,
  ): Promise<KnowledgeDocumentDto> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('knowledge-documents'))`;
      const current = await tx.knowledgeDocument.findUnique({ where: { id } });
      if (!current) throw new NotFoundException();
      if ((current.archivedAt !== null) === archived) {
        throw conflict(
          'knowledge-state',
          archived ? 'This document is already archived' : 'This document is already in use',
        );
      }
      if (!archived) {
        const [inUse, same] = await Promise.all([
          tx.knowledgeDocument.count({ where: { archivedAt: null } }),
          tx.knowledgeDocument.findFirst({
            where: {
              sha256: current.sha256,
              archivedAt: null,
              audience: current.audience,
              language: current.language,
            },
            select: { id: true },
          }),
        ]);
        if (same) {
          throw conflict('knowledge-duplicate', 'This document is already in the knowledge base');
        }
        if (inUse >= KNOWLEDGE_MAX_DOCUMENTS) {
          throw conflict('knowledge-full', 'The knowledge base is full; archive a document first');
        }
      }
      const row = await tx.knowledgeDocument.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audit.record(
        {
          action: archived ? 'agent.knowledge_archived' : 'agent.knowledge_restored',
          actorUserId: staff.userId,
          targetType: 'knowledge_document',
          targetId: id,
          context: staff.context,
        },
        tx,
      );
      return dto(row);
    });
  }

  /**
   * The passages that best match a question, among documents in use for these audiences and
   * in this language. Any word of the question may match (a question is longer than the rule
   * that answers it) and passages matching more of them, or matching in a heading, rank first.
   */
  async search(
    question: string,
    audiences: readonly KnowledgeAudience[],
    language: KnowledgeLanguage,
    limit = KNOWLEDGE_HITS,
  ): Promise<KnowledgeHit[]> {
    if (audiences.length === 0) return [];
    const config = KNOWLEDGE_SEARCH_CONFIG[language];
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        heading: string | null;
        body: string;
        document_id: string;
        title: string;
        audience: string;
        language: string;
        updated_at: Date;
      }[]
    >`
      WITH q AS (
        SELECT string_agg(quote_literal(lexeme), ' | ')::tsquery AS query
          FROM unnest(tsvector_to_array(to_tsvector(${config}::regconfig, ${question}))) AS lexeme
      )
      SELECT c.id, c.heading, c.body, d.id AS document_id, d.title, d.audience, d.language,
             d.updated_at
        FROM q
        JOIN knowledge_chunks c ON c.search @@ q.query
        JOIN knowledge_documents d ON d.id = c.document_id
       WHERE d.archived_at IS NULL
         AND d.language = ${language}
         AND d.audience = ANY(${[...audiences]})
       ORDER BY ts_rank_cd(c.search, q.query) DESC, c.id
       LIMIT ${limit}`;
    return rows.map((row) => ({
      passageId: row.id,
      documentId: row.document_id,
      document: row.title,
      audience: row.audience as KnowledgeAudience,
      language: row.language as KnowledgeLanguage,
      heading: row.heading,
      body: row.body,
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  private async assertClean(bytes: Buffer): Promise<void> {
    let verdict: 'clean' | 'infected';
    try {
      verdict = await this.scanner.scan(bytes);
    } catch (error) {
      if (!(error instanceof ScanFailedError)) throw error;
      // Never read as clean: staff upload again once the scanner answers.
      throw refused(
        HttpStatus.SERVICE_UNAVAILABLE,
        'scan-unavailable',
        'The virus check is not available right now',
        'Try again in a few minutes.',
      );
    }
    if (verdict === 'infected') {
      throw refused(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'document-infected',
        'This file failed the virus check',
      );
    }
  }
}
