import { describe, expect, it } from 'vitest';

import {
  asksForSecrets,
  checkGrounding,
  figuresIn,
  leaksInstructions,
  namedTools,
  outcomeClaims,
  plainAnswerText,
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

describe('what the assistant never does or asks', () => {
  it('reads "I have booked, paid, refunded, cancelled" as a claim only a status can support', () => {
    const cases: [string, string][] = [
      ['I have booked your flight to London.', 'confirmed'],
      ["I've just confirmed the hotel for you.", 'confirmed'],
      ['I have sent NGN 500,000.00 to that account.', 'paid'],
      ['I have charged your card.', 'paid'],
      ['I have refunded the fare.', 'refunded'],
      ['I have cancelled the booking.', 'cancelled'],
      ["J'ai annulé votre réservation.", 'cancelled'],
      ["J'ai remboursé le billet.", 'refunded'],
      ['Cancelei a sua reserva.', 'cancelled'],
      ['Reembolsei o valor.', 'refunded'],
    ];
    for (const [answer, claim] of cases) {
      expect([answer, outcomeClaims(answer)]).toEqual([answer, [claim]]);
      expect(unsupportedOutcomes(answer, [])).toEqual([claim]);
    }
    // Approving a refund is two claims: that it was decided, and that the money goes back.
    expect(outcomeClaims('I have approved your refund.')).toEqual(['refunded', 'approved']);
    // What it may say about itself.
    for (const answer of [
      'I have checked your booking.',
      'I have not booked anything.',
      'I have sent you the options below.',
      'I cannot cancel a booking myself.',
    ]) {
      expect([answer, outcomeClaims(answer)]).toEqual([answer, []]);
    }
  });

  it('never says that what it prepared in the turn was approved', () => {
    const waits = [{ key: 'approvalstatus', value: 'pending' }];
    for (const answer of [
      'Done. The new recipe is approved and the site reads again.',
      'The promo code was approved.',
      'I have approved it for you.',
      "J'ai approuvé la demande.",
      'O código foi aprovado.',
      'تمت الموافقة على الطلب',
    ]) {
      expect([answer, unsupportedOutcomes(answer, waits)]).toEqual([answer, ['approved']]);
    }
    // What it may say of a proposal that waits.
    for (const answer of [
      'I prepared the recipe. It waits for someone else to approve it.',
      'It has not been approved yet.',
      'Once it is approved, the site is read with the new recipe.',
      'It needs to be approved by someone who manages data sources.',
    ]) {
      expect([answer, unsupportedOutcomes(answer, waits)]).toEqual([answer, []]);
    }
    // Without a proposal in the turn, "approved" is a word about what a tool counted or a
    // status it returned: two sites are approved, a company trip was approved.
    expect(unsupportedOutcomes('Two sites are approved and one is in review.', [])).toEqual([]);
    expect(
      unsupportedOutcomes('Your trip was approved by your company.', [
        { key: 'company.approvalstatus', value: 'approved' },
      ]),
    ).toEqual([]);
    // A status that says approved supports it even beside a proposal that waits.
    expect(
      unsupportedOutcomes('The earlier request was approved.', [
        ...waits,
        { key: 'requests.approvalstatus', value: 'approved' },
      ]),
    ).toEqual([]);
  });

  it('catches a request for card details, codes, passwords and document numbers', () => {
    for (const answer of [
      'Sure, please send your card number, expiry date and CVV.',
      'Tell me the one-time code you received so I can verify you.',
      'What is your password? I will log in for you.',
      'I need your passport number to continue.',
      'Please type your OTP here.',
      'Envoyez-moi le numéro de carte et le code de sécurité.',
      'Digite a sua senha para continuar.',
      'أرسل رقم البطاقة من فضلك',
    ]) {
      expect([answer, asksForSecrets(answer)]).toEqual([answer, true]);
    }
  });

  it('lets advice against sharing them, and ordinary questions, through', () => {
    for (const answer of [
      'I never take card details in chat. You can pay on the booking page.',
      'Never share your OTP or your password with anyone, including us.',
      'Do not send your card number here.',
      'You enter your passport details yourself at checkout.',
      'Which date would you like to fly?',
      'Ne communiquez jamais votre mot de passe.',
    ]) {
      expect([answer, asksForSecrets(answer)]).toEqual([answer, false]);
    }
  });
});

describe('plainAnswerText (ADR-112)', () => {
  it('turns a Markdown answer into the plain text the clients draw', () => {
    const markdown = [
      '## Flights on 10 December',
      'I found **two direct flights** from Lagos to Abuja:',
      '',
      '',
      '1. **Air Peace** (Economy)',
      '   * Departs Lagos: 07:15',
      '   * Price: NGN 96,500.00',
      '- Ibom Air, __refundable__, `QI 0304`',
      '+ *Free* cancellation until 3 December',
      '---',
      'Shall I hold one?',
    ].join('\n');
    expect(plainAnswerText(markdown)).toBe(
      [
        'Flights on 10 December',
        'I found two direct flights from Lagos to Abuja:',
        '',
        '1. Air Peace (Economy)',
        '   • Departs Lagos: 07:15',
        '   • Price: NGN 96,500.00',
        '• Ibom Air, refundable, QI 0304',
        '• Free cancellation until 3 December',
        '',
        'Shall I hold one?',
      ].join('\n'),
    );
  });

  it('leaves plain words, figures, links and names with stars or underscores alone', () => {
    for (const text of [
      'Three flights leave on Friday, from NGN 96,500.',
      'Open https://suskii.example/trips/a_b_c to see it.',
      'The trip_builder agent and 5 * 3 = 15 stay as written.',
      'Room 2*4 is booked.',
    ]) {
      expect(plainAnswerText(text)).toBe(text);
    }
    expect(plainAnswerText('  \n**\n')).toBe('**');
    expect(plainAnswerText('---\n***')).toBe('');
  });
});
