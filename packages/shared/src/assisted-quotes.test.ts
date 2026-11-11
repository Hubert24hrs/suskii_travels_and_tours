import { describe, expect, it } from 'vitest';

import {
  assistedOfferDetailsSchema,
  assistedQuoteBookable,
  assistedQuoteInputSchema,
} from './assisted-quotes';

const input = {
  product: 'hotel',
  title: 'Eko Signature, sea view room',
  request: { destination: 'Lagos', startDate: '2026-12-10', endDate: '2026-12-13', adults: 2 },
  currency: 'NGN',
};

describe('assisted quote input', () => {
  it('takes places, dates and head counts, with the defaults filled in', () => {
    expect(assistedQuoteInputSchema.parse(input)).toEqual({
      ...input,
      request: { ...input.request, origin: null, children: 0 },
      observationId: null,
    });
  });

  it('refuses contact details and links in its words: who travels is entered at checkout', () => {
    for (const title of [
      'Room for ada@example.com',
      'Call me on +234 801 234 5678',
      'see www.example.com/deal',
    ]) {
      expect(assistedQuoteInputSchema.safeParse({ ...input, title }).success).toBe(false);
    }
    const place = { ...input, request: { ...input.request, destination: 'mail bola@example.com' } };
    expect(assistedQuoteInputSchema.safeParse(place).success).toBe(false);
  });

  it('refuses an end before the start, nobody travelling and an unknown currency', () => {
    const bad = [
      { ...input, request: { ...input.request, endDate: '2026-12-09' } },
      { ...input, request: { ...input.request, adults: 0 } },
      { ...input, currency: 'XXX' },
      { ...input, product: 'yacht' },
    ];
    for (const entry of bad) expect(assistedQuoteInputSchema.safeParse(entry).success).toBe(false);
  });
});

describe('what staff offer', () => {
  it('needs what it is, when, and its terms in words', () => {
    const details = {
      title: 'Eko Signature, sea view room',
      summary: 'Two nights with breakfast. Free cancellation until 7 December.',
      startDate: '2026-12-10',
      endDate: '2026-12-13',
      refundable: true,
    };
    expect(assistedOfferDetailsSchema.parse(details)).toEqual({
      ...details,
      cityName: null,
      countryCode: null,
    });
    expect(assistedOfferDetailsSchema.safeParse({ ...details, summary: 'ok' }).success).toBe(false);
    expect(
      assistedOfferDetailsSchema.safeParse({ ...details, endDate: '2026-12-01' }).success,
    ).toBe(false);
  });
});

describe('assistedQuoteBookable', () => {
  const now = new Date('2026-11-11T10:00:00Z');
  it('is true only on offer and before the offer lapses', () => {
    const later = '2026-11-11T11:00:00Z';
    expect(assistedQuoteBookable({ status: 'offered', offerExpiresAt: later }, now)).toBe(true);
    expect(assistedQuoteBookable({ status: 'offered', offerExpiresAt: now }, now)).toBe(false);
    expect(assistedQuoteBookable({ status: 'offered', offerExpiresAt: null }, now)).toBe(false);
    expect(assistedQuoteBookable({ status: 'requested', offerExpiresAt: later }, now)).toBe(false);
    expect(assistedQuoteBookable({ status: 'booked', offerExpiresAt: later }, now)).toBe(false);
  });
});
