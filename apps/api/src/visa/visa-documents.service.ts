import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  safeFileName,
  sniffDocumentType,
  VISA_UPLOAD_STATUSES,
  visaChecklistSchema,
  type VisaDocumentType,
} from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import type { BookingCaller } from '../bookings/bookings.service';
import { BackgroundTasks } from '../common/background-tasks';
import { ProblemDetailsException } from '../common/problem-details';
import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { FieldEncryption } from '../crypto/field-encryption';
import { HmacService } from '../crypto/hmac.service';
import { ObjectStorage } from '../documents/object-storage';
import type { VisaDocument } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import { AntivirusScanner, ScanFailedError } from './antivirus';
import {
  documentKeyContext,
  documentNameContext,
  openDocument,
  sealDocument,
  sha256Hex,
} from './document-crypto';
import type { VisaApplicationDto } from './visa.schemas';
import { applicationConflict, VisaService, type StaffActor } from './visa.service';

/** Uploads per application, all items and replacements together: a cap against storage abuse. */
const MAX_UPLOADS_PER_APPLICATION = 60;
const MAX_SCAN_ATTEMPTS = 5;
/** Pending documents older than this are picked up by the worker (a lost background scan). */
const SCAN_PICKUP_AFTER_MS = 60_000;
const SCAN_BATCH = 20;
const DAY_MS = 86_400_000;

export const documentType = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    'document-type',
    'This file type is not accepted',
    'Upload a PDF, JPEG or PNG file.',
  );

export const documentTooLarge = (maxBytes: number): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.PAYLOAD_TOO_LARGE,
    'document-too-large',
    'This file is too large',
    `Upload a file of at most ${Math.floor(maxBytes / 1_000_000)} MB.`,
    { maxBytes },
  );

const uploadLimit = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'upload-limit',
    'Too many uploads for this application',
    'Contact our visa team to continue.',
  );

/** A viewer a link is minted for: the booking's owner or a visa officer. */
export type LinkViewer =
  { kind: 'customer'; bookingId: string } | { kind: 'staff'; userId: string };

const viewerId = (viewer: LinkViewer): string =>
  viewer.kind === 'customer' ? `c.${viewer.bookingId}` : `s.${viewer.userId}`;

const VIEWABLE: readonly VisaDocument['status'][] = ['clean', 'rejected'];

/**
 * Visa documents (ADR-026): type sniffed from the bytes, size-limited, sealed with a per-document
 * key wrapped by field encryption, scanned before use, served only through short-lived signed
 * links minted for the owner or a visa officer, and deleted after the retention period. Deleting
 * a document also wipes its wrapped key, so any stray copy of the blob is unreadable.
 */
@Injectable()
export class VisaDocumentsService {
  private readonly logger = new Logger(VisaDocumentsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    private readonly encryption: FieldEncryption,
    private readonly hmac: HmacService,
    private readonly scanner: AntivirusScanner,
    private readonly audit: AuditService,
    private readonly background: BackgroundTasks,
    private readonly visa: VisaService,
  ) {}

  /** Largest upload accepted (`VISA_DOCUMENT_MAX_BYTES`). */
  get maxBytes(): number {
    return this.config.VISA_DOCUMENT_MAX_BYTES;
  }

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------

  async upload(
    input: {
      bookingId: string;
      applicationId: string;
      checklistKey: string;
      bytes: Buffer;
      fileName: string;
    },
    caller: BookingCaller,
  ): Promise<VisaApplicationDto> {
    const application = await this.visa.loadForOwner(input.bookingId, input.applicationId, caller);
    if (!VISA_UPLOAD_STATUSES.includes(application.status)) {
      throw applicationConflict('Documents cannot be changed while the application is reviewed.');
    }
    const checklist = visaChecklistSchema.parse(application.product.checklist);
    if (!checklist.some((item) => item.key === input.checklistKey)) throw new NotFoundException();
    if (application.documents.length >= MAX_UPLOADS_PER_APPLICATION) throw uploadLimit();
    if (input.bytes.byteLength === 0) throw documentType();
    if (input.bytes.byteLength > this.config.VISA_DOCUMENT_MAX_BYTES) {
      throw documentTooLarge(this.config.VISA_DOCUMENT_MAX_BYTES);
    }
    // The declared type and extension are ignored: only the bytes decide (ADR-026).
    const type: VisaDocumentType | null = sniffDocumentType(input.bytes);
    if (!type) throw documentType();

    const id = uuidv7();
    const sealed = sealDocument(input.bytes, id);
    const storageKey = `visa/${application.id}/${id}.bin`;
    await this.storage.put(storageKey, sealed.blob, 'application/octet-stream');
    let replaced: string[];
    try {
      replaced = await this.prisma.$transaction(async (tx) => {
        const previous = await tx.visaDocument.findMany({
          where: {
            applicationId: application.id,
            checklistKey: input.checklistKey,
            supersededAt: null,
          },
          select: { id: true, storageKey: true },
        });
        if (previous.length > 0) {
          await tx.visaDocument.updateMany({
            where: { id: { in: previous.map((document) => document.id) } },
            data: {
              supersededAt: new Date(),
              deletedAt: new Date(),
              storageKey: null,
              wrappedKey: '',
            },
          });
        }
        await tx.visaDocument.create({
          data: {
            id,
            applicationId: application.id,
            checklistKey: input.checklistKey,
            storageKey,
            contentType: type,
            sizeBytes: input.bytes.byteLength,
            sha256: sealed.sha256,
            wrappedKey: this.encryption.encrypt(sealed.dataKey, documentKeyContext(id)),
            fileNameEncrypted: this.encryption.encrypt(
              safeFileName(input.fileName, type),
              documentNameContext(id),
            ),
            uploadedByUserId: caller.client.userId,
          },
        });
        await this.audit.record(
          {
            action: 'visa.document_uploaded',
            actorUserId: caller.client.userId,
            targetType: 'visa_document',
            targetId: id,
            context: caller.context,
            metadata: {
              applicationId: application.id,
              checklistKey: input.checklistKey,
              sizeBytes: String(input.bytes.byteLength),
            },
          },
          tx,
        );
        return previous.flatMap((document) => (document.storageKey ? [document.storageKey] : []));
      });
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
    for (const key of replaced) await this.storage.delete(key);
    this.background.run('visa-scan', () => this.scan(id));
    return this.visa.ownerView(await this.visa.reload(application.id));
  }

  // -------------------------------------------------------------------------
  // Scanning
  // -------------------------------------------------------------------------

  /** Scans one pending document; returns the outcome (or null when there was nothing to do). */
  async scan(documentId: string): Promise<'clean' | 'infected' | 'failed' | null> {
    const document = await this.prisma.visaDocument.findUnique({ where: { id: documentId } });
    if (document?.status !== 'pending_scan' || !document.storageKey) return null;
    let verdict: 'clean' | 'infected';
    try {
      const plaintext = await this.plaintext(document);
      verdict = await this.scanner.scan(plaintext);
    } catch (error) {
      const reason = error instanceof ScanFailedError ? error.message : (error as Error).name;
      this.logger.warn({ documentId, reason }, 'visa document scan failed');
      const attempts = document.scanAttempts + 1;
      const giveUp = attempts >= MAX_SCAN_ATTEMPTS;
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.visaDocument.updateMany({
          where: { id: document.id, status: 'pending_scan' },
          data: { scanAttempts: attempts, ...(giveUp ? { status: 'scan_failed' } : {}) },
        });
        if (count === 1 && giveUp) {
          await this.visa.event(tx, document.applicationId, null, {
            kind: 'document_scan_failed',
            fromStatus: null,
            toStatus: null,
            message: 'We could not check one of your files. Please upload it again.',
            note: null,
          });
        }
      });
      return 'failed';
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.visaDocument.updateMany({
        where: { id: document.id, status: 'pending_scan' },
        data:
          verdict === 'clean'
            ? { status: 'clean', scannedAt: new Date() }
            : {
                status: 'infected',
                scannedAt: new Date(),
                storageKey: null,
                wrappedKey: '',
                deletedAt: new Date(),
              },
      });
      if (count !== 1) return;
      await this.audit.record(
        {
          action: 'visa.document_scanned',
          actorType: 'system',
          targetType: 'visa_document',
          targetId: document.id,
          metadata: { verdict, scanner: this.scanner.name },
        },
        tx,
      );
      if (verdict === 'infected') {
        await this.visa.event(tx, document.applicationId, null, {
          kind: 'document_infected',
          fromStatus: null,
          toStatus: null,
          message:
            'A file you uploaded failed our virus check and was deleted. Please upload another copy.',
          note: null,
        });
      }
    });
    if (verdict === 'infected') await this.storage.delete(document.storageKey);
    return verdict;
  }

  /** Pending documents whose background scan did not finish (worker, every few minutes). */
  async scanDue(
    now = new Date(),
  ): Promise<Record<'scanned' | 'clean' | 'infected' | 'failed', number>> {
    const due = await this.prisma.visaDocument.findMany({
      where: {
        status: 'pending_scan',
        uploadedAt: { lt: new Date(now.getTime() - SCAN_PICKUP_AFTER_MS) },
      },
      select: { id: true },
      orderBy: { uploadedAt: 'asc' },
      take: SCAN_BATCH,
    });
    const counts = { scanned: 0, clean: 0, infected: 0, failed: 0 };
    for (const { id } of due) {
      const outcome = await this.scan(id);
      if (!outcome) continue;
      counts.scanned += 1;
      counts[outcome] += 1;
    }
    return counts;
  }

  // -------------------------------------------------------------------------
  // Signed links and content
  // -------------------------------------------------------------------------

  async ownerLink(
    input: { bookingId: string; applicationId: string; documentId: string },
    caller: BookingCaller,
  ): Promise<{ url: string; expiresAt: string }> {
    const application = await this.visa.loadForOwner(input.bookingId, input.applicationId, caller);
    const document = application.documents.find((candidate) => candidate.id === input.documentId);
    if (!document || !this.viewable(document)) throw new NotFoundException();
    return this.link(
      document,
      { kind: 'customer', bookingId: application.bookingId },
      caller.client.userId,
      caller.context,
    );
  }

  async officerLink(
    documentId: string,
    staff: StaffActor,
  ): Promise<{ url: string; expiresAt: string }> {
    const document = await this.prisma.visaDocument.findUnique({ where: { id: documentId } });
    if (!document || !this.viewable(document)) throw new NotFoundException();
    return this.link(
      document,
      { kind: 'staff', userId: staff.userId },
      staff.userId,
      staff.context,
    );
  }

  private viewable(document: VisaDocument): boolean {
    return (
      VIEWABLE.includes(document.status) && !document.deletedAt && document.storageKey !== null
    );
  }

  private async link(
    document: VisaDocument,
    viewer: LinkViewer,
    actorUserId: string | null,
    context: StaffActor['context'],
  ): Promise<{ url: string; expiresAt: string }> {
    const expires = Date.now() + this.config.VISA_DOCUMENT_URL_TTL_SECONDS * 1000;
    const who = viewerId(viewer);
    const signature = this.hmac.digest('visa-document-url', `${document.id}.${expires}.${who}`);
    await this.audit.record({
      action: 'visa.document_link_issued',
      actorUserId,
      targetType: 'visa_document',
      targetId: document.id,
      context,
      metadata: { viewer: who, expires: new Date(expires).toISOString() },
    });
    const query = new URLSearchParams({ expires: String(expires), viewer: who, signature });
    return {
      url: `/v1/visa/documents/${document.id}/content?${query.toString()}`,
      expiresAt: new Date(expires).toISOString(),
    };
  }

  /**
   * The bytes behind a signed link: 404 for an expired, altered or foreign link, a document that
   * is not clean, or one whose content no longer matches its hash.
   */
  async content(
    documentId: string,
    query: { expires: number; viewer: string; signature: string },
    context: StaffActor['context'],
  ): Promise<{ bytes: Buffer; contentType: string; fileName: string }> {
    const valid =
      query.expires > Date.now() &&
      this.hmac.verify(
        'visa-document-url',
        `${documentId}.${query.expires}.${query.viewer}`,
        query.signature,
      );
    if (!valid) throw new NotFoundException();
    const document = await this.prisma.visaDocument.findUnique({ where: { id: documentId } });
    if (!document || !this.viewable(document)) throw new NotFoundException();
    const bytes = await this.plaintext(document);
    if (sha256Hex(bytes) !== document.sha256) {
      this.logger.error({ documentId }, 'visa document failed its integrity check');
      throw new NotFoundException();
    }
    await this.audit.record({
      action: 'visa.document_accessed',
      actorType: query.viewer.startsWith('s.') ? 'user' : 'anonymous',
      actorUserId: query.viewer.startsWith('s.') ? query.viewer.slice(2) : null,
      targetType: 'visa_document',
      targetId: document.id,
      context,
      metadata: { viewer: query.viewer },
    });
    return {
      bytes,
      contentType: document.contentType,
      fileName: this.encryption.decrypt(
        document.fileNameEncrypted,
        documentNameContext(document.id),
      ),
    };
  }

  private async plaintext(document: VisaDocument): Promise<Buffer> {
    if (!document.storageKey || !document.wrappedKey) throw new NotFoundException();
    const blob = await this.storage.get(document.storageKey);
    if (!blob) throw new NotFoundException();
    const dataKey = this.encryption.decrypt(document.wrappedKey, documentKeyContext(document.id));
    return openDocument(blob, dataKey, document.id);
  }

  // -------------------------------------------------------------------------
  // Officer review
  // -------------------------------------------------------------------------

  async reject(documentId: string, message: string, staff: StaffActor): Promise<void> {
    const document = await this.prisma.visaDocument.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException();
    if (document.status !== 'clean' || document.supersededAt) {
      throw applicationConflict('Only a current, clean document can be rejected.');
    }
    const application = await this.visa.reload(document.applicationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.visaDocument.update({ where: { id: document.id }, data: { status: 'rejected' } });
      await this.visa.event(tx, document.applicationId, staff, {
        kind: 'document_rejected',
        fromStatus: null,
        toStatus: null,
        message,
        note: null,
      });
      await this.audit.record(
        {
          action: 'visa.document_rejected',
          actorUserId: staff.userId,
          targetType: 'visa_document',
          targetId: document.id,
          context: staff.context,
          metadata: { applicationId: document.applicationId },
        },
        tx,
      );
    });
    this.visa.notify(application, application.status, message);
  }

  // -------------------------------------------------------------------------
  // Retention
  // -------------------------------------------------------------------------

  /**
   * Deletes documents `VISA_DOCUMENT_RETENTION_DAYS` after their application closed, or after its
   * booking ended without confirmation or was refunded (ADR-026). Metadata stays; bytes, keys and
   * file names go.
   */
  async prune(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.VISA_DOCUMENT_RETENTION_DAYS * DAY_MS);
    const documents = await this.prisma.visaDocument.findMany({
      where: {
        deletedAt: null,
        application: {
          OR: [
            { closedAt: { lt: cutoff } },
            {
              booking: {
                status: { in: ['CANCELLED', 'REFUNDED', 'FAILED', 'EXPIRED'] },
                updatedAt: { lt: cutoff },
              },
            },
          ],
        },
      },
      select: { id: true, storageKey: true },
      take: 500,
    });
    for (const document of documents) {
      await this.prisma.visaDocument.update({
        where: { id: document.id },
        data: { storageKey: null, wrappedKey: '', fileNameEncrypted: '', deletedAt: now },
      });
      if (document.storageKey) await this.storage.delete(document.storageKey);
    }
    if (documents.length > 0) {
      await this.audit.record({
        action: 'visa.documents_pruned',
        actorType: 'system',
        targetType: 'visa_document',
        targetId: documents[0]?.id ?? '',
        metadata: { count: String(documents.length) },
      });
    }
    return documents.length;
  }
}
