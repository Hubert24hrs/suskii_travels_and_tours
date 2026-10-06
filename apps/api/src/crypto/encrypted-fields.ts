import type { PrismaService } from '../infra/prisma.service';

import {
  addonDetailsContext,
  contactContext,
  documentKeyContext,
  documentNameContext,
  factorContext,
  idempotencySealContext,
  noteContext,
  passportContext,
  pushTokenContext,
  voucherContext,
} from './encryption-contexts';
import type { FieldEncryption } from './field-encryption';

/**
 * Where field encryption is used (ADR-038; the cryptography inventory in docs/security lists the
 * same). `encrypted-fields.spec.ts` fails when a column named like ciphertext is missing here.
 * Identifiers are constants, never input, so they are safe to put into SQL.
 */
export interface EncryptedField {
  table: string;
  /** A text column holding the envelope, or a JSONB column holding it under `jsonKey`. */
  column: string;
  jsonKey?: string;
  /** The column the context is derived from. */
  contextColumn: string;
  context: (value: string) => string;
  /** What the value is, for the inventory. */
  purpose: string;
}

export const ENCRYPTED_FIELDS: readonly EncryptedField[] = [
  {
    table: 'mfa_factors',
    column: 'secret_ciphertext',
    contextColumn: 'user_id',
    context: factorContext,
    purpose: 'TOTP seed',
  },
  {
    table: 'bookings',
    column: 'contact_encrypted',
    contextColumn: 'id',
    context: contactContext,
    purpose: 'Booking contact email and phone',
  },
  {
    table: 'booking_passengers',
    column: 'passport_encrypted',
    contextColumn: 'id',
    context: (id) => passportContext('booking-passenger', id),
    purpose: 'Passenger passport number',
  },
  {
    table: 'travellers',
    column: 'passport_encrypted',
    contextColumn: 'id',
    context: (id) => passportContext('traveller', id),
    purpose: 'Saved traveller passport number',
  },
  {
    table: 'booking_items',
    column: 'payload',
    jsonKey: 'detailsEncrypted',
    contextColumn: 'id',
    context: addonDetailsContext,
    purpose: 'Add-on details (insurance and transfer particulars)',
  },
  {
    table: 'booking_vouchers',
    column: 'code_encrypted',
    contextColumn: 'id',
    context: voucherContext,
    purpose: 'Voucher code',
  },
  {
    table: 'booking_notes',
    column: 'body_encrypted',
    contextColumn: 'id',
    context: noteContext,
    purpose: 'Staff note on a booking',
  },
  {
    table: 'push_tokens',
    column: 'token_encrypted',
    contextColumn: 'id',
    context: pushTokenContext,
    purpose: 'Device push token',
  },
  {
    table: 'idempotency_keys',
    column: 'response_body',
    jsonKey: 'sealed',
    contextColumn: 'id',
    context: idempotencySealContext,
    purpose: 'Stored response replayed for a retried write (may hold guest tokens)',
  },
  {
    table: 'visa_documents',
    column: 'wrapped_key',
    contextColumn: 'id',
    context: documentKeyContext,
    purpose: 'Data key of a visa document (the file is sealed with it)',
  },
  {
    table: 'visa_documents',
    column: 'file_name_encrypted',
    contextColumn: 'id',
    context: documentNameContext,
    purpose: 'Visa document file name',
  },
];

export const fieldName = (field: EncryptedField): string =>
  `${field.table}.${field.column}${field.jsonKey ? `.${field.jsonKey}` : ''}`;

type RawClient = Pick<PrismaService, '$queryRawUnsafe' | '$executeRawUnsafe'>;

export interface ReencryptionResult {
  field: string;
  /** Envelopes not under the current key when the run started. */
  stale: number;
  rewritten: number;
}

const FIRST_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Rewrites every envelope not under the current key (ADR-038, docs/runbooks/key-rotation.md). Rows
 * are read in id order, decrypted with the key ring and encrypted under the current key; each
 * update only applies if the envelope is still the one read, so a concurrent write wins. Without
 * `confirm` it only counts.
 */
export async function reencryptFields(
  prisma: RawClient,
  encryption: FieldEncryption,
  options: { confirm: boolean; batchSize?: number; fields?: readonly EncryptedField[] },
): Promise<ReencryptionResult[]> {
  const batchSize = Math.max(1, Math.min(Math.trunc(options.batchSize ?? 500), 5000));
  const results: ReencryptionResult[] = [];
  for (const field of options.fields ?? ENCRYPTED_FIELDS) {
    const value = field.jsonKey ? `${field.column}->>'${field.jsonKey}'` : field.column;
    const result: ReencryptionResult = { field: fieldName(field), stale: 0, rewritten: 0 };
    let cursor = FIRST_ID;
    for (;;) {
      const rows = await prisma.$queryRawUnsafe<{ id: string; ctx: string; envelope: string }[]>(
        `SELECT id::text AS id, ${field.contextColumn}::text AS ctx, ${value} AS envelope
           FROM ${field.table}
          WHERE id > $1::uuid AND ${value} IS NOT NULL
          ORDER BY id
          LIMIT ${batchSize}`,
        cursor,
      );
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]?.id ?? cursor;
      for (const row of rows) {
        if (encryption.isCurrent(row.envelope)) continue;
        result.stale += 1;
        if (!options.confirm) continue;
        const context = field.context(row.ctx);
        const next = encryption.encrypt(encryption.decrypt(row.envelope, context), context);
        const updated = field.jsonKey
          ? await prisma.$executeRawUnsafe(
              `UPDATE ${field.table}
                  SET ${field.column} = jsonb_set(${field.column}, '{${field.jsonKey}}', to_jsonb($1::text))
                WHERE id = $2::uuid AND ${value} = $3`,
              next,
              row.id,
              row.envelope,
            )
          : await prisma.$executeRawUnsafe(
              `UPDATE ${field.table} SET ${field.column} = $1 WHERE id = $2::uuid AND ${field.column} = $3`,
              next,
              row.id,
              row.envelope,
            );
        result.rewritten += updated;
      }
    }
    results.push(result);
  }
  return results;
}
