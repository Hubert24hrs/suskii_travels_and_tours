import { describe, expect, it } from 'vitest';

import { MODEL_RESULT_MAX_CHARS, cardsOf, renderForModel, statusFactsOf } from './render.js';

describe('what a model reads of a tool result', () => {
  it('formats money, in currencies with and without minor units', () => {
    expect(renderForModel({ total: { amountMinor: 1_234_550, currency: 'NGN' } })).toBe(
      '{"total":"NGN 12,345.50"}',
    );
    expect(renderForModel({ total: { amountMinor: 5000, currency: 'XOF' } })).toContain('5,000');
    // Not money: an object that only looks a little like it stays as it is.
    expect(renderForModel({ price: { amountMinor: 100, currency: 'NGN', note: 'x' } })).toContain(
      '"amountMinor":100',
    );
  });

  it('leaves cards out, cuts long text and long lists, and bounds the whole', () => {
    const text = renderForModel({
      card: { kind: 'link', title: 'x', lines: [] },
      cards: [{ kind: 'link', title: 'y', lines: [] }],
      description: 'a'.repeat(900),
      items: Array.from({ length: 50 }, (_, index) => ({ index })),
    });
    expect(text).not.toContain('"card');
    expect(text).toContain(`${'a'.repeat(500)}…`);
    expect(text).toContain('"index":19');
    expect(text).not.toContain('"index":20');
    const huge = renderForModel({ rows: Array.from({ length: 20 }, () => 'b'.repeat(499)) });
    expect(huge.length).toBeLessThanOrEqual(MODEL_RESULT_MAX_CHARS + 10);
    expect(renderForModel(undefined)).toBe('null');
  });

  it('keeps only cards that fit the schema', () => {
    expect(
      cardsOf({
        card: { kind: 'hotel', title: 'Sample Hotel', lines: ['2 nights'], href: '/hotels/abc' },
        cards: [
          { kind: 'hotel', title: 'Elsewhere', lines: [], href: '//evil.example' },
          { kind: 'spaceship', title: 'No', lines: [] },
          'not a card',
        ],
      }),
    ).toEqual([{ kind: 'hotel', title: 'Sample Hotel', lines: ['2 nights'], href: '/hotels/abc' }]);
    expect(cardsOf('text')).toEqual([]);
  });

  it('finds every status with where it sat', () => {
    expect(
      statusFactsOf({
        booking: { status: 'CONFIRMED', items: [{ ticketStatus: 'issued' }] },
        refund: { status: 'succeeded' },
        cards: [{ status: 'ignored' }],
        statusNote: 7,
      }),
    ).toEqual([
      { key: 'booking.status', value: 'confirmed' },
      { key: 'booking.items.ticketstatus', value: 'issued' },
      { key: 'refund.status', value: 'succeeded' },
    ]);
  });
});
