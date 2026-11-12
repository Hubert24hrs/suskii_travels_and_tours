import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ENCRYPTED_FIELDS, fieldName } from './encrypted-fields';

/** `(table, column)` of every Prisma field whose name says it holds ciphertext. */
function ciphertextColumns(): string[] {
  const schema = readFileSync(join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8');
  const found: string[] = [];
  for (const block of schema.split(/\nmodel /).slice(1)) {
    const table = /@@map\("([^"]+)"\)/.exec(block)?.[1];
    if (!table) continue;
    for (const line of block.split('\n')) {
      const field = /^\s+(\w+)\s+String\??\s.*@map\("([^"]+)"\)/.exec(line);
      if (field?.[1] && field[2] && /(Encrypted|Ciphertext|wrappedKey)$/.test(field[1])) {
        found.push(`${table}.${field[2]}`);
      }
    }
  }
  return found.sort();
}

describe('ENCRYPTED_FIELDS (ADR-038)', () => {
  it('lists every column named like ciphertext', () => {
    const listed = ENCRYPTED_FIELDS.filter((field) => !field.jsonKey).map(fieldName);
    expect(listed.sort()).toEqual(ciphertextColumns());
    expect(listed.length).toBeGreaterThanOrEqual(9);
  });

  it('also lists the envelopes kept inside JSON columns', () => {
    expect(ENCRYPTED_FIELDS.filter((field) => field.jsonKey).map(fieldName)).toEqual([
      'booking_items.payload.detailsEncrypted',
      'idempotency_keys.response_body.sealed',
    ]);
  });

  it('binds each value to its own row', () => {
    const contexts = ENCRYPTED_FIELDS.map((field) =>
      field.context('0192f0e0-0000-7000-8000-000000000001'),
    );
    expect(new Set(contexts).size).toBe(contexts.length);
    for (const context of contexts)
      expect(context).toContain('0192f0e0-0000-7000-8000-000000000001');
  });
});
