import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Prisma } from '../generated/prisma/client';

import { DATA_REGISTRY, EXPORT_SECTIONS, type DataTreatment } from './data-registry';

const schemaModels = (): string[] => {
  const schema = readFileSync(resolve(__dirname, '../../prisma/schema.prisma'), 'utf8');
  return [...schema.matchAll(/^model (\w+) \{/gm)].map((match) => match[1] ?? '');
};

const entries = Object.entries(DATA_REGISTRY) as [string, DataTreatment][];

describe('DSAR data registry (ADR-029)', () => {
  it('decides the treatment of every table in the schema', () => {
    const registered = Object.keys(DATA_REGISTRY).sort();
    expect(registered).toEqual(schemaModels().sort());
    // The generated client must agree with the schema (a stale client would hide a table).
    expect(registered).toEqual(Object.values(Prisma.ModelName).sort());
  });

  it('uses every export section and only known ones', () => {
    const used = new Set(entries.flatMap(([, treatment]) => treatment.section ?? []));
    expect([...used].sort()).toEqual([...EXPORT_SECTIONS].sort());
  });

  it('exports nothing from tables without personal data', () => {
    for (const [model, treatment] of entries) {
      if (treatment.deletion === 'none') expect([model, treatment.section]).toEqual([model, null]);
      expect(treatment.note.length).toBeGreaterThan(5);
    }
  });

  it('keeps the money and audit trail and removes credentials', () => {
    for (const model of ['LedgerEntry', 'LedgerTransaction', 'Payment', 'Refund', 'AuditLog']) {
      expect(DATA_REGISTRY[model as keyof typeof DATA_REGISTRY].deletion).toBe('retain');
    }
    for (const model of ['RefreshToken', 'VerificationToken', 'BookingAccessLink']) {
      const treatment = DATA_REGISTRY[model as keyof typeof DATA_REGISTRY];
      expect([treatment.deletion, treatment.section]).toEqual(['delete', null]);
    }
  });
});
