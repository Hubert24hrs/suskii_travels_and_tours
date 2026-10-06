import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT = Buffer.from('SVD1');

export { documentKeyContext, documentNameContext } from '../crypto/encryption-contexts';

export interface SealedDocument {
  /** `SVD1 | iv | tag | ciphertext`: what object storage holds. */
  blob: Buffer;
  /** The random data key (base64), to be wrapped by field encryption and never stored clear. */
  dataKey: string;
  /** SHA-256 of the plaintext, hex. */
  sha256: string;
}

/**
 * Envelope encryption of an uploaded document (ADR-026): a fresh 256-bit key per document,
 * AES-256-GCM with the document id as additional data, so a blob copied to another document
 * fails to decrypt.
 */
export function sealDocument(plaintext: Uint8Array, documentId: string): SealedDocument {
  const key = randomBytes(32);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(documentId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    blob: Buffer.concat([FORMAT, iv, cipher.getAuthTag(), ciphertext]),
    dataKey: key.toString('base64'),
    sha256: createHash('sha256').update(plaintext).digest('hex'),
  };
}

/** Decrypts a sealed document; throws when the blob, key or id do not match. */
export function openDocument(blob: Buffer, dataKey: string, documentId: string): Buffer {
  if (blob.length < FORMAT.length + IV_BYTES + TAG_BYTES || !blob.subarray(0, 4).equals(FORMAT)) {
    throw new Error('Unsupported document format');
  }
  const iv = blob.subarray(4, 4 + IV_BYTES);
  const tag = blob.subarray(4 + IV_BYTES, 4 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(dataKey, 'base64'), iv);
  decipher.setAAD(Buffer.from(documentId, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(blob.subarray(4 + IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
}

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
