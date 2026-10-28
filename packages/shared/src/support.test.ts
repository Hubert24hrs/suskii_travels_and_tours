import { describe, expect, it } from 'vitest';

import {
  SUPPORT_REFERENCE_ALPHABET,
  SUPPORT_REFERENCE_PATTERN,
  isWhatsAppStop,
  parseSupportHours,
  supportDeliveryAdvances,
  supportDueAt,
  supportPriority,
  supportSchedule,
  supportSlaState,
  supportStaffed,
  type SupportTargets,
  whatsappWindowClosesAt,
  whatsappWindowOpen,
} from './support';
import { supportStartSchema } from './support-schemas';

const now = new Date('2026-11-02T10:00:00Z');
const inHours = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
const targets: SupportTargets = {
  urgent: { responseMinutes: 15, resolutionMinutes: 240 },
  prime: { responseMinutes: 30, resolutionMinutes: 480 },
  normal: { responseMinutes: 120, resolutionMinutes: 1_440 },
};

describe('support priority (ADR-083)', () => {
  const priority = (tripStartsAt: Date | null, prime = false) =>
    supportPriority({ tripStartsAt, prime, now, urgentHours: 48 });

  it('is urgent for a trip starting within the window or started in the last day', () => {
    expect(priority(inHours(47))).toBe('urgent');
    expect(priority(inHours(-23), true)).toBe('urgent');
  });

  it('puts Prime members in their queue, everyone else in the normal one', () => {
    expect(priority(inHours(72), true)).toBe('prime');
    expect(priority(inHours(-30))).toBe('normal');
    expect(priority(null)).toBe('normal');
  });
});

describe('support schedule', () => {
  it('owes a reply after the first unanswered message and resolution after opening', () => {
    const opened = supportSchedule(
      { status: 'open', priority: 'prime', openedAt: now, replyOwedSince: inHours(1) },
      targets,
    );
    expect(opened.responseDueAt).toEqual(supportDueAt(inHours(1), 30));
    expect(opened.resolutionDueAt).toEqual(supportDueAt(now, 480));
    expect(opened.dueAt).toEqual(opened.responseDueAt);
  });

  it('falls back to the resolution while waiting and clears everything once resolved', () => {
    const waiting = supportSchedule(
      { status: 'waiting', priority: 'normal', openedAt: now, replyOwedSince: null },
      targets,
    );
    expect(waiting).toEqual({
      responseDueAt: null,
      resolutionDueAt: supportDueAt(now, 1_440),
      dueAt: supportDueAt(now, 1_440),
    });
    expect(
      supportSchedule(
        { status: 'resolved', priority: 'urgent', openedAt: now, replyOwedSince: now },
        targets,
      ),
    ).toEqual({ responseDueAt: null, resolutionDueAt: null, dueAt: null });
  });
});

describe('support SLA state', () => {
  const conversation = (overrides: Partial<Parameters<typeof supportSlaState>[0]> = {}) => ({
    status: 'open' as const,
    priority: 'normal' as const,
    responseDueAt: supportDueAt(now, 120),
    resolutionDueAt: supportDueAt(now, 1_440),
    ...overrides,
  });

  it('tracks the reply owed, then the resolution', () => {
    expect(supportSlaState(conversation(), targets, now)).toBe('on_track');
    // The last fifth of two hours is 24 minutes.
    expect(supportSlaState(conversation(), targets, supportDueAt(now, 97))).toBe('due_soon');
    expect(supportSlaState(conversation(), targets, supportDueAt(now, 121))).toBe('breached');
    const waiting = conversation({ status: 'waiting', responseDueAt: null });
    expect(supportSlaState(waiting, targets, supportDueAt(now, 121))).toBe('on_track');
    expect(supportSlaState(waiting, targets, supportDueAt(now, 1_441))).toBe('breached');
  });

  it('gives short targets at least five minutes of warning and resolved ones nothing to meet', () => {
    const urgent = conversation({ priority: 'urgent', responseDueAt: supportDueAt(now, 15) });
    expect(supportSlaState(urgent, targets, supportDueAt(now, 9))).toBe('on_track');
    expect(supportSlaState(urgent, targets, supportDueAt(now, 11))).toBe('due_soon');
    expect(supportSlaState(conversation({ status: 'resolved' }), targets, inHours(99))).toBe('met');
  });
});

describe('support references and input', () => {
  it('uses an alphabet without look-alike characters that the pattern accepts', () => {
    expect(SUPPORT_REFERENCE_ALPHABET).toHaveLength(30);
    expect(SUPPORT_REFERENCE_ALPHABET).not.toMatch(/[01ILOU]/);
    expect(`S-${SUPPORT_REFERENCE_ALPHABET.slice(0, 6)}`).toMatch(SUPPORT_REFERENCE_PATTERN);
    expect('S-OI1L0U').not.toMatch(SUPPORT_REFERENCE_PATTERN);
  });

  it('trims messages, refuses empty ones and normalises the email', () => {
    const parsed = supportStartSchema.parse({
      category: 'payment',
      message: '  Can I pay in parts?  ',
      email: ' Ada@Example.COM ',
    });
    expect(parsed).toMatchObject({ message: 'Can I pay in parts?', email: 'ada@example.com' });
    expect(supportStartSchema.safeParse({ category: 'payment', message: '   ' }).success).toBe(
      false,
    );
    expect(
      supportStartSchema.safeParse({ category: 'payment', message: 'x'.repeat(2_001) }).success,
    ).toBe(false);
  });
});

describe('whatsapp delivery and window (ADR-084)', () => {
  it('moves delivery forward only, and fails only before delivery', () => {
    expect(supportDeliveryAdvances('pending', 'sent')).toBe(true);
    expect(supportDeliveryAdvances('sent', 'read')).toBe(true);
    expect(supportDeliveryAdvances('read', 'delivered')).toBe(false);
    expect(supportDeliveryAdvances('delivered', 'delivered')).toBe(false);
    expect(supportDeliveryAdvances('sent', 'failed')).toBe(true);
    expect(supportDeliveryAdvances('delivered', 'failed')).toBe(false);
    expect(supportDeliveryAdvances('failed', 'read')).toBe(false);
  });

  it('keeps the window open for 24 hours after the last message', () => {
    expect(whatsappWindowOpen(null, now)).toBe(false);
    expect(whatsappWindowOpen(inHours(-23.9), now)).toBe(true);
    expect(whatsappWindowOpen(inHours(-24), now)).toBe(false);
    expect(whatsappWindowClosesAt(inHours(-1), now)).toEqual(inHours(23));
    expect(whatsappWindowClosesAt(inHours(-25), now)).toBeNull();
  });

  it('treats only the stop words on their own as an opt-out', () => {
    expect(isWhatsAppStop(' STOP ')).toBe(true);
    expect(isWhatsAppStop('Unsubscribe.')).toBe(true);
    expect(isWhatsAppStop('cancel')).toBe(false);
    expect(isWhatsAppStop('please stop my booking')).toBe(false);
  });
});

describe('staffed hours (ADR-085)', () => {
  it('reads day ranges, single days and wrapping ranges', () => {
    expect(parseSupportHours('')).toEqual([]);
    expect(parseSupportHours(' Mon-Fri 08:00-20:00 ,  sat 09:00-14:00')).toEqual([
      { days: ['mon', 'tue', 'wed', 'thu', 'fri'], fromMinute: 480, toMinute: 1200 },
      { days: ['sat'], fromMinute: 540, toMinute: 840 },
    ]);
    expect(parseSupportHours('fri-mon 00:00-24:00')?.[0]?.days).toEqual([
      'fri',
      'sat',
      'sun',
      'mon',
    ]);
    expect(parseSupportHours('mon-sun 00:00-24:00')?.[0]?.days).toHaveLength(7);
  });

  it('refuses what it cannot read', () => {
    for (const text of [
      'weekdays 9-5',
      'mon 8:00-20:00',
      'mon 20:00-08:00',
      'mon 08:60-20:00',
      'xyz 08:00-20:00',
      'mon 00:00-24:01',
    ]) {
      expect(parseSupportHours(text)).toBeNull();
    }
  });

  it('is staffed only inside a span, in the support time zone', () => {
    const hours = parseSupportHours('mon-fri 08:00-20:00') ?? [];
    // Monday 2026-11-02: 07:00 UTC is 08:00 in Lagos (UTC+1).
    expect(supportStaffed(hours, 'Africa/Lagos', new Date('2026-11-02T07:00:00Z'))).toBe(true);
    expect(supportStaffed(hours, 'Africa/Lagos', new Date('2026-11-02T06:59:00Z'))).toBe(false);
    expect(supportStaffed(hours, 'Africa/Lagos', new Date('2026-11-02T19:00:00Z'))).toBe(false);
    // Saturday.
    expect(supportStaffed(hours, 'Africa/Lagos', new Date('2026-11-07T12:00:00Z'))).toBe(false);
    // Friday 23:30 UTC is already Saturday in Nairobi (UTC+3).
    const friday = parseSupportHours('fri 00:00-24:00') ?? [];
    expect(supportStaffed(friday, 'Africa/Nairobi', new Date('2026-11-06T23:30:00Z'))).toBe(false);
    expect(supportStaffed(friday, 'Africa/Lagos', new Date('2026-11-06T22:30:00Z'))).toBe(true);
    expect(supportStaffed([], 'Africa/Lagos', new Date('2026-11-02T10:00:00Z'))).toBe(false);
  });
});
