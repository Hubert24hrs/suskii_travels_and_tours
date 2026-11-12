import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { sniffDocumentType, type DriverDocumentKind } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { BackgroundTasks } from '../common/background-tasks';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { driverDocumentKeyContext } from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';
import { ObjectStorage } from '../documents/object-storage';
import type { DriverDocument } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { AntivirusScanner } from '../visa/antivirus';
import { openDocument, sealDocument, sha256Hex } from '../visa/document-crypto';
import { documentTooLarge, documentType } from '../visa/visa-documents.service';

/** Uploads per driver, replacements included: a cap against storage abuse. */
const MAX_UPLOADS_PER_DRIVER = 40;

const uploadLimit = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'upload-limit',
    'Too many uploads',
    'Contact driver support to continue.',
  );

/**
 * Driver documents (ADR-050), handled like visa documents (ADR-026): type sniffed from the bytes,
 * size-limited, sealed with a per-document key wrapped by field encryption (`driver-document:{id}`),
 * scanned before review, and readable only by staff with `drivers:review`, each read audited.
 * A new upload of a kind replaces the earlier one and wipes its key.
 */
@Injectable()
export class DriverDocumentsService {
  private readonly logger = new Logger(DriverDocumentsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    private readonly encryption: FieldEncryption,
    private readonly scanner: AntivirusScanner,
    private readonly audit: AuditService,
    private readonly background: BackgroundTasks,
  ) {}

  get maxBytes(): number {
    return this.config.VISA_DOCUMENT_MAX_BYTES;
  }

  async upload(
    driverId: string,
    kind: DriverDocumentKind,
    bytes: Buffer,
    actor: { userId: string; context: RequestContext },
  ): Promise<void> {
    const uploads = await this.prisma.driverDocument.count({ where: { driverId } });
    if (uploads >= MAX_UPLOADS_PER_DRIVER) throw uploadLimit();
    if (bytes.byteLength === 0) throw documentType();
    if (bytes.byteLength > this.maxBytes) throw documentTooLarge(this.maxBytes);
    const type = sniffDocumentType(bytes);
    if (!type) throw documentType();

    const id = uuidv7();
    const sealed = sealDocument(bytes, id);
    const storageKey = `drivers/${driverId}/${id}.bin`;
    await this.storage.put(storageKey, sealed.blob, 'application/octet-stream');
    let replaced: string[];
    try {
      replaced = await this.prisma.$transaction(async (tx) => {
        const previous = await tx.driverDocument.findMany({
          where: { driverId, kind, supersededAt: null },
          select: { id: true, storageKey: true },
        });
        if (previous.length > 0) {
          await tx.driverDocument.updateMany({
            where: { id: { in: previous.map((document) => document.id) } },
            data: {
              supersededAt: new Date(),
              deletedAt: new Date(),
              storageKey: null,
              wrappedKey: '',
            },
          });
        }
        await tx.driverDocument.create({
          data: {
            id,
            driverId,
            kind,
            storageKey,
            contentType: type,
            sizeBytes: bytes.byteLength,
            sha256: sealed.sha256,
            wrappedKey: this.encryption.encrypt(sealed.dataKey, driverDocumentKeyContext(id)),
          },
        });
        await this.audit.record(
          {
            action: 'driver.document_uploaded',
            actorUserId: actor.userId,
            targetType: 'driver_document',
            targetId: id,
            context: actor.context,
            metadata: { driverId, kind, sizeBytes: String(bytes.byteLength) },
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
    this.background.run('driver-document-scan', () => this.scan(id));
  }

  /**
   * Scans a pending document: clean ones wait for review; infected ones are deleted and rejected.
   * A scanner failure leaves the document pending; staff cannot approve it until it scans clean.
   */
  async scan(documentId: string): Promise<'clean' | 'infected' | 'failed' | null> {
    const document = await this.prisma.driverDocument.findUnique({ where: { id: documentId } });
    if (document?.status !== 'pending' || !document.storageKey) return null;
    let verdict: 'clean' | 'infected';
    try {
      verdict = await this.scanner.scan(await this.plaintext(document));
    } catch (error) {
      this.logger.warn(
        { documentId, reason: (error as Error).name },
        'driver document scan failed',
      );
      return 'failed';
    }
    const { count } = await this.prisma.driverDocument.updateMany({
      where: { id: document.id, status: 'pending' },
      data:
        verdict === 'clean'
          ? { status: 'clean' }
          : {
              status: 'rejected',
              rejectionReason: 'documents_unclear',
              storageKey: null,
              wrappedKey: '',
              deletedAt: new Date(),
            },
    });
    if (count === 1 && verdict === 'infected') await this.storage.delete(document.storageKey);
    return verdict;
  }

  /** Pending documents whose background scan did not finish (worker, with the visa sweep). */
  async scanDue(now = new Date()): Promise<number> {
    const due = await this.prisma.driverDocument.findMany({
      where: {
        status: 'pending',
        storageKey: { not: null },
        createdAt: { lt: new Date(now.getTime() - 60_000) },
      },
      select: { id: true },
      take: 20,
    });
    let scanned = 0;
    for (const { id } of due) if (await this.scan(id)) scanned += 1;
    return scanned;
  }

  /** The bytes of a document for a reviewer; every read is audited. */
  async content(
    driverId: string,
    documentId: string,
    staff: { userId: string; context: RequestContext },
  ): Promise<{ bytes: Buffer; contentType: string; kind: string }> {
    const document = await this.prisma.driverDocument.findUnique({ where: { id: documentId } });
    if (document?.driverId !== driverId || document.status === 'pending' || !document.storageKey) {
      throw new NotFoundException();
    }
    const bytes = await this.plaintext(document);
    if (sha256Hex(bytes) !== document.sha256) {
      this.logger.error({ documentId }, 'driver document failed its integrity check');
      throw new NotFoundException();
    }
    await this.audit.record({
      action: 'driver.document_accessed',
      actorUserId: staff.userId,
      targetType: 'driver_document',
      targetId: document.id,
      context: staff.context,
      metadata: { driverId, kind: document.kind },
    });
    return { bytes, contentType: document.contentType, kind: document.kind };
  }

  private async plaintext(document: DriverDocument): Promise<Buffer> {
    if (!document.storageKey || !document.wrappedKey) throw new NotFoundException();
    const blob = await this.storage.get(document.storageKey);
    if (!blob) throw new NotFoundException();
    const dataKey = this.encryption.decrypt(
      document.wrappedKey,
      driverDocumentKeyContext(document.id),
    );
    return openDocument(blob, dataKey, document.id);
  }
}
