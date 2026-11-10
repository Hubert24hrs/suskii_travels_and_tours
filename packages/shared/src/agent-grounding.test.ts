import { describe, expect, it } from 'vitest';

import {
  checkGrounding,
  figuresIn,
  leaksInstructions,
  namedTools,
  outcomeClaims,
  unsupportedOutcomes,
} from './agent-grounding';

describe('figures', () => {
  it('reads grouped amounts, dates and times as plain numbers', () => {
    expect([...figuresIn('NGN 250,000.00 on 2026-12-01 at 10:25')].sort((a, b) => a - b)).toEqual([
      0, 1, 10, 12, 25, 2026, 250000,
    ]);
    expect(figuresIn('250 000,00').has(250000)).toBe(true);
    expect(figuresIn('250.000,00').has(250000)).toBe(true);
    expect(figuresIn('1,250,000NGN').has(1250000)).toBe(true);
  });
});

describe('grounding (ADR-107)', () => {
  const facts = [
    '{"count":2,"flights":[{"carrier":"XY","departure":"2026-12-01T10:25","price":"NGN 250,000.00"}]}',
    'I want to fly to Abuja on 1 December with 2 friends',
    'today 2026-11-10',
  ];

  it('passes an answer whose figures all come from the turn', () => {
    expect(
      checkGrounding(
        'I found 2 flights. The first leaves on 1 December at 10:25 for NGN 250,000.',
        facts,
      ),
    ).toEqual({ ok: true, issues: [], figures: [] });
  });

  it('blocks a price, a date or a time no tool returned', () => {
    const price = checkGrounding('It costs NGN 199,000.', facts);
    expect(price).toMatchObject({ ok: false, issues: ['figure'], figures: [199000] });
    expect(checkGrounding('It leaves at 14:40.', facts).figures).toEqual([14, 40]);
    expect(checkGrounding('Visas take 7 days.', facts).ok).toBe(false);
  });

  it('lets a numbered list number itself', () => {
    expect(checkGrounding('1. Morning flight\n2. Evening flight\n3) Night flight', facts).ok).toBe(
      true,
    );
    // A number inside a line is still a statement.
    expect(checkGrounding('Option 3 is the cheapest.', facts).ok).toBe(false);
  });

  it('blocks a link, an address or a phone number that is not quoted from a source', () => {
    expect(checkGrounding('Pay at https://pay.example.com/now', facts).issues).toEqual(['contact']);
    expect(checkGrounding('Write to help@example.com', facts).issues).toEqual(['contact']);
    expect(checkGrounding('Call +234 801 234 5678', facts).issues).toEqual(['contact']);
    const withContact = [...facts, 'support phone +234 801 234 5678, https://suskii.example/help'];
    expect(
      checkGrounding('Call +234 (801) 234-5678 or see https://suskii.example/help', withContact).ok,
    ).toBe(true);
  });

  it('refuses digits it cannot read', () => {
    expect(checkGrounding('السعر ٢٥٠٠٠٠', facts).issues).toContain('other_digits');
  });
});

describe('outcomes only the records may state (ADR-107)', () => {
  it('finds a stated outcome in each language, and not its negation or its future', () => {
    expect(outcomeClaims('Your booking is confirmed and the payment was successful.')).toEqual([
      'confirmed',
      'paid',
    ]);
    expect(outcomeClaims('Votre réservation a été confirmée.')).toEqual(['confirmed']);
    expect(outcomeClaims('O reembolso foi reembolsado e a reserva foi cancelada.')).toEqual([
      'refunded',
      'cancelled',
    ]);
    expect(outcomeClaims('Malipo yako imelipwa.')).toEqual(['paid']);
    expect(outcomeClaims('تم تأكيد الحجز')).toEqual(['confirmed']);
    expect(outcomeClaims('Your money don refunded.')).toEqual(['refunded']);

    expect(outcomeClaims('Your booking is not confirmed yet.')).toEqual([]);
    expect(outcomeClaims("It hasn't been paid.")).toEqual([]);
    expect(outcomeClaims('Tap to confirm, and you will be charged once it is paid for.')).toEqual(
      [],
    );
    expect(outcomeClaims('I can ask a person to check whether it can be refunded.')).toEqual([]);
  });

  it('accepts an outcome only when a status in the turn says the same', () => {
    const answer = 'Your booking is confirmed and has been paid.';
    expect(unsupportedOutcomes(answer, [])).toEqual(['confirmed', 'paid']);
    expect(
      unsupportedOutcomes(answer, [{ key: 'booking.status', value: 'awaiting_payment' }]),
    ).toEqual(['confirmed', 'paid']);
    expect(unsupportedOutcomes(answer, [{ key: 'booking.status', value: 'confirmed' }])).toEqual(
      [],
    );
    // A payment that succeeded does not make a refund sent.
    expect(
      unsupportedOutcomes('Your refund has been sent, it was refunded.', [
        { key: 'payment.status', value: 'succeeded' },
      ]),
    ).toEqual(['refunded']);
    expect(
      unsupportedOutcomes('It was refunded.', [{ key: 'refund.status', value: 'succeeded' }]),
    ).toEqual([]);
  });
});

describe('disclosure', () => {
  const RULES = [
    'You are the flights specialist of SUSKII T&T: you help travellers find flights, compare options and understand fares, bags and seats.',
    'You cannot book, pay, refund, cancel, change or confirm anything, and you never take payment or card details in chat. Never say that something was booked, paid, refunded, cancelled or confirmed unless the status in a tool result says so.',
  ];

  it('catches instructions read back word for word, in any case and punctuation', () => {
    expect(
      leaksInstructions(
        'Sure! My instructions say: "You are the flights specialist of SUSKII T&T: you help travellers find flights, compare options and understand fares".',
        RULES,
      ),
    ).toBe(true);
    expect(
      leaksInstructions(
        'NEVER SAY THAT SOMETHING WAS BOOKED PAID REFUNDED CANCELLED OR CONFIRMED UNLESS THE STATUS SAYS SO',
        RULES,
      ),
    ).toBe(true);
  });

  it('lets an honest answer about its limits through', () => {
    // Nine words in a row with the rule it paraphrases: not a leak.
    expect(
      leaksInstructions(
        'I cannot book, pay, refund, cancel, change or confirm anything myself, but I can show you where to do it.',
        RULES,
      ),
    ).toBe(false);
    expect(leaksInstructions('I help travellers find flights.', RULES)).toBe(false);
    expect(leaksInstructions('', RULES)).toBe(false);
    expect(leaksInstructions('Anything at all, as long as you like it to be.', [])).toBe(false);
  });

  it('finds the tools an answer names, as the registry or as a model writes them', () => {
    const tools = ['flights.search', 'bookings.get', 'support.handover'];
    expect(namedTools('I can call flights.search and bookings__get for you.', tools)).toEqual([
      'flights.search',
      'bookings.get',
    ]);
    expect(namedTools('I can search flights and look at your bookings.', tools)).toEqual([]);
  });
});

describe('how something is paid is not a payment', () => {
  it('reads a rule about where or how a fee is paid as no claim', () => {
    for (const rule of [
      'The government fee is paid separately.',
      'The balance is paid at the hotel when you arrive.',
      'City tax is paid on arrival.',
      'The deposit is paid directly to the branch.',
      'La taxe de séjour est payée sur place.',
    ]) {
      expect([rule, outcomeClaims(rule)]).toEqual([rule, []]);
    }
  });

  it('still reads a payment that is said to have arrived as one', () => {
    for (const claim of [
      'Your booking is paid.',
      'It is paid in full.',
      'Your payment was received.',
      'Votre réservation est payée.',
      'The fee was paid at 10:25 today.',
    ]) {
      expect([claim, outcomeClaims(claim)]).toEqual([claim, ['paid']]);
    }
  });
});
