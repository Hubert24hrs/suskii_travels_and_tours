import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { sniffDocumentType } from '@suskii/shared';

import { ProblemDetailsException } from '../common/problem-details';
import { FieldEncryption } from '../crypto/field-encryption';
import { ObjectStorage } from '../documents/object-storage';
import { AntivirusScanner } from '../visa/antivirus';
import { openDocument, sealDocument, sha256Hex } from '../visa/document-crypto';
import { documentType } from '../visa/visa-documents.service';

export interface SealedFile {
  storageKey: string;
  wrappedKey: string;
  sha256: string;
  contentType: string;
  sizeBytes: number;
}

export const infectedFile = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'document-infected',
    'This file failed the virus check',
    'Take the photo or scan again and upload the new file.',
  );

/**
 * Rental files (licence scans, handover photos) sealed exactly like visa documents (ADR-026):
 * the type is sniffed from the bytes, the file is encrypted with its own key under the record's
 * id, and the key is wrapped by field encryption with the caller's context.
 */
@Injectable()
export class RentalFiles {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly encryption: FieldEncryption,
    private readonly scanner: AntivirusScanner,
  ) {}

  /** Seals and stores bytes; `images` refuses PDFs. Throws 415 for any other type. */
  async seal(
    id: string,
    bytes: Buffer,
    folder: string,
    context: string,
    options: { images?: boolean } = {},
  ): Promise<SealedFile> {
    if (bytes.byteLength === 0) throw documentType();
    const type = sniffDocumentType(bytes);
    if (!type || (options.images && type === 'application/pdf')) throw documentType();
    const sealed = sealDocument(bytes, id);
    const storageKey = `${folder}/${id}.bin`;
    await this.storage.put(storageKey, sealed.blob, 'application/octet-stream');
    return {
      storageKey,
      wrappedKey: this.encryption.encrypt(sealed.dataKey, context),
      sha256: sealed.sha256,
      contentType: type,
      sizeBytes: bytes.byteLength,
    };
  }

  /** Scans bytes now; staff uploads are small and checked before they count. */
  async assertClean(bytes: Buffer): Promise<void> {
    if ((await this.scanner.scan(bytes)) === 'infected') throw infectedFile();
  }

  scan(bytes: Buffer): Promise<'clean' | 'infected'> {
    return this.scanner.scan(bytes);
  }

  /** The plaintext of a stored file; 404 when it is gone or no longer matches its hash. */
  async open(
    file: { id: string; storageKey: string | null; wrappedKey: string; sha256: string | null },
    context: string,
  ): Promise<Buffer> {
    if (!file.storageKey || !file.wrappedKey) throw new NotFoundException();
    const blob = await this.storage.get(file.storageKey);
    if (!blob) throw new NotFoundException();
    const bytes = openDocument(blob, this.encryption.decrypt(file.wrappedKey, context), file.id);
    if (file.sha256 && sha256Hex(bytes) !== file.sha256) throw new NotFoundException();
    return bytes;
  }

  async delete(storageKey: string | null): Promise<void> {
    if (storageKey) await this.storage.delete(storageKey);
  }
}
