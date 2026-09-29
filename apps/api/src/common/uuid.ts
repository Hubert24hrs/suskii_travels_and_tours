import { randomBytes } from 'node:crypto';

/**
 * RFC 9562 UUID version 7: a 48-bit Unix millisecond timestamp followed by 74 random bits, the
 * same format Postgres rows get from `uuid(7)`. Generated in the application when a row's id must
 * be known before the insert, e.g. to bind an encrypted field's context to it.
 */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
