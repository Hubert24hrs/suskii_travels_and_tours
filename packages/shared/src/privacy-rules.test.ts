import { describe, expect, it } from 'vitest';

import {
  PRIVACY_JURISDICTIONS,
  PRIVACY_REQUEST_KINDS,
  PRIVACY_RULES,
  breachNoticeDueAt,
  privacyJurisdiction,
  privacyRequestDueAt,
} from './privacy-rules';
import {
  privacyBreachCreateSchema,
  privacyBreachNoticeSchema,
  privacyRequestCloseSchema,
  privacyRequestCreateSchema,
} from './privacy-register-schemas';

const at = (iso: string): Date => new Date(iso);

describe('privacy jurisdictions', () => {
  it('maps countries to the law that governs them', () => {
    expect(privacyJurisdiction('NG')).toBe('NG');
    expect(privacyJurisdiction('ke')).toBe('KE');
    expect(privacyJurisdiction('ZA')).toBe('ZA');
    expect(privacyJurisdiction('GB')).toBe('GB');
    expect(privacyJurisdiction('FR')).toBe('EU');
    expect(privacyJurisdiction('IE')).toBe('EU');
    expect(privacyJurisdiction('GH')).toBe('OTHER');
    expect(privacyJurisdiction(null)).toBe('OTHER');
  });

  it('has a rule for every jurisdiction and request kind, each with a source', () => {
    for (const jurisdiction of PRIVACY_JURISDICTIONS) {
      const rules = PRIVACY_RULES[jurisdiction];
      expect(rules.breach.source).not.toBe('');
      for (const kind of PRIVACY_REQUEST_KINDS) {
        const deadline = rules.requests[kind];
        expect(Boolean(deadline.days) !== Boolean(deadline.months)).toBe(true);
        expect(deadline.source).not.toBe('');
      }
    }
  });
});

describe('request deadlines', () => {
  const received = at('2026-10-28T09:00:00.000Z');

  it("uses Kenya's statutory days: access in 7, rectification and erasure in 14", () => {
    expect(privacyRequestDueAt('access', 'KE', received).toISOString()).toBe(
      '2026-11-04T09:00:00.000Z',
    );
    expect(privacyRequestDueAt('rectification', 'KE', received).toISOString()).toBe(
      '2026-11-11T09:00:00.000Z',
    );
    expect(privacyRequestDueAt('erasure', 'KE', received).toISOString()).toBe(
      '2026-11-11T09:00:00.000Z',
    );
    expect(PRIVACY_RULES.KE.requests.access.statutory).toBe(true);
  });

  it('gives GDPR one calendar month, ending on the last day when the date does not exist', () => {
    expect(privacyRequestDueAt('access', 'EU', received).toISOString()).toBe(
      '2026-11-28T09:00:00.000Z',
    );
    expect(privacyRequestDueAt('erasure', 'GB', at('2027-01-31T12:00:00.000Z')).toISOString()).toBe(
      '2027-02-28T12:00:00.000Z',
    );
  });

  it('uses the internal 30-day target where the law sets no number', () => {
    expect(privacyRequestDueAt('access', 'NG', received).toISOString()).toBe(
      '2026-11-27T09:00:00.000Z',
    );
    expect(PRIVACY_RULES.NG.requests.access.statutory).toBe(false);
  });
});

describe('breach notice deadlines', () => {
  it('counts 72 hours from awareness for every regulator', () => {
    const aware = at('2026-10-28T23:30:00.000Z');
    for (const jurisdiction of PRIVACY_JURISDICTIONS) {
      expect(breachNoticeDueAt(jurisdiction, aware).toISOString()).toBe('2026-10-31T23:30:00.000Z');
    }
    expect(PRIVACY_RULES.ZA.breach.statutory).toBe(false);
  });
});

describe('register inputs', () => {
  it('takes an account or an email address for a request, not both or neither', () => {
    const base = {
      kind: 'access',
      jurisdiction: 'KE',
      channel: 'email',
      receivedAt: '2026-10-27T10:00:00.000Z',
    };
    expect(
      privacyRequestCreateSchema.safeParse({ ...base, subjectEmail: 'a@example.com' }).success,
    ).toBe(true);
    expect(privacyRequestCreateSchema.safeParse(base).success).toBe(false);
    expect(
      privacyRequestCreateSchema.safeParse({
        ...base,
        subjectEmail: 'a@example.com',
        userId: '0190f6a2-0000-7000-8000-000000000001',
      }).success,
    ).toBe(false);
    expect(
      privacyRequestCreateSchema.safeParse({
        ...base,
        channel: 'self_service',
        subjectEmail: 'a@example.com',
      }).success,
    ).toBe(false);
  });

  it('refuses a request received in the future', () => {
    const later = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      privacyRequestCreateSchema.safeParse({
        kind: 'access',
        jurisdiction: 'NG',
        channel: 'email',
        receivedAt: later,
        subjectEmail: 'a@example.com',
      }).success,
    ).toBe(false);
  });

  it('needs a reason to refuse a request', () => {
    expect(privacyRequestCloseSchema.safeParse({ outcome: 'completed' }).success).toBe(true);
    expect(privacyRequestCloseSchema.safeParse({ outcome: 'refused' }).success).toBe(false);
    expect(
      privacyRequestCloseSchema.safeParse({ outcome: 'refused', reason: 'no_data' }).success,
    ).toBe(true);
  });

  it('validates breaches and notices', () => {
    const breach = {
      title: 'Export link sent to the wrong address',
      details: 'One booking export emailed to a mistyped address.',
      awareAt: '2026-10-28T08:00:00.000Z',
      highRisk: false,
      categories: ['contact', 'booking'],
      jurisdictions: ['NG'],
    };
    expect(privacyBreachCreateSchema.safeParse(breach).success).toBe(true);
    expect(
      privacyBreachCreateSchema.safeParse({ ...breach, jurisdictions: ['NG', 'NG'] }).success,
    ).toBe(false);
    expect(
      privacyBreachNoticeSchema.safeParse({ decision: 'notified', jurisdiction: 'NG' }).success,
    ).toBe(false);
    expect(
      privacyBreachNoticeSchema.safeParse({
        decision: 'notified',
        jurisdiction: 'NG',
        regulatorNotifiedAt: '2026-10-28T10:00:00.000Z',
        regulatorReference: 'NDPC-123',
      }).success,
    ).toBe(true);
    expect(
      privacyBreachNoticeSchema.safeParse({ decision: 'not_required', jurisdiction: 'KE' }).success,
    ).toBe(true);
  });
});
