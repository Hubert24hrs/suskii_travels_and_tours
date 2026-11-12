import {
  LlmError,
  LlmProvider,
  type LlmExtraction,
  type LlmResult,
} from '../../ai-search/llm-provider';
import { MockLlmProvider } from '../../ai-search/mock-llm-provider';
import type { BookingDto } from '../../bookings/bookings.schemas';

import { checkAnswer, figures } from './assistant-checks';
import { assistantBookingFacts } from './assistant-facts';
import { supportAssistantSystem } from './assistant-prompt';
import { SupportAnswerer } from './support-answerer';

const known = new Map([
  ['faq-4', 'When will I get my refund?\nCard refunds usually arrive within 5 to 10 working days.'],
  ['flight.1', 'Flight 1: Lagos (LOS) to Dubai (DXB), departs 2026-12-01 10:25 (local times).'],
  ['booking.plan', 'Next instalment ₦735,000.00 due 2026-11-15 00:00 UTC.'],
]);
const answer = (text: string, sources: string[]) => ({ answerable: true, answer: text, sources });

describe('assistant answer checks (ADR-085)', () => {
  it('reads figures regardless of grouping, decimals and leading zeros', () => {
    expect([...figures('₦250,000.00 due 2026-12-01 at 10:25')]).toEqual([
      250000, 0, 2026, 12, 1, 10, 25,
    ]);
    expect(figures('250 000,00 ₦')).toEqual(figures('₦250,000.00'));
    expect(figures('250.000,00')).toEqual(figures('250,000.00'));
  });

  it('accepts an answer whose figures all come from the sources it cites', () => {
    expect(
      checkAnswer(answer('Your flight leaves on 1 December 2026 at 10:25.', ['flight.1']), known),
    ).toEqual({
      ok: true,
      answer: 'Your flight leaves on 1 December 2026 at 10:25.',
      sources: ['flight.1'],
    });
    expect(
      checkAnswer(
        answer('Your next instalment is ₦735,000, due 2026-11-15.', ['booking.plan']),
        known,
      ).ok,
    ).toBe(true);
  });

  it('refuses invented figures, figures from sources it did not cite, and unknown sources', () => {
    const reason = (text: string, sources: string[]) => {
      const checked = checkAnswer(answer(text, sources), known);
      return checked.ok ? null : checked.reason;
    };
    expect(reason('Refunds take 3 days.', ['faq-4'])).toBe('figure_not_in_sources');
    expect(reason('Your flight leaves at 10:25 and refunds take 5 to 10 days.', ['flight.1'])).toBe(
      'figure_not_in_sources',
    );
    expect(reason('Your flight leaves soon.', ['flight.9'])).toBe('unknown_source');
    expect(reason('Your flight leaves soon.', [])).toBe('no_sources');
    expect(reason('   ', ['flight.1'])).toBe('empty');
    expect(reason('x'.repeat(1_201), ['flight.1'])).toBe('too_long');
    expect(reason('رحلتك في ١٠:٢٥', ['flight.1'])).toBe('non_latin_digits');
  });

  it('refuses links, email addresses and phone numbers the sources do not contain', () => {
    const reason = (text: string) => {
      const checked = checkAnswer(answer(text, ['faq-4']), known);
      return checked.ok ? null : checked.reason;
    };
    expect(reason('See https://example.com/refunds for more.')).toBe('contact_not_in_sources');
    expect(reason('Write to refunds@example.com.')).toBe('contact_not_in_sources');
    expect(reason('Refunds take 5 to 10 working days.')).toBeNull();
  });

  it('does not send an answer the model marked unanswerable', () => {
    expect(checkAnswer({ answerable: false, answer: 'maybe', sources: ['faq-4'] }, known)).toEqual({
      ok: false,
      reason: 'unanswerable',
    });
  });
});

describe('assistantBookingFacts (ADR-085)', () => {
  const money = (amountMinor: number, currency = 'NGN') => ({ amountMinor, currency });
  const booking = {
    id: '0190f0aa-0000-7000-8000-000000000001',
    reference: 'SUS-7KX2Q9',
    status: 'CONFIRMED',
    contact: { email: 'a***@example.com', phone: '+234 *** **78' },
    price: { total: money(124_500_000) },
    paid: money(124_500_000),
    amountDue: null,
    paymentDeadline: null,
    paymentOptions: null,
    paymentPlan: null,
    pendingPriceChange: null,
    company: null,
    flight: {
      owner: { code: 'EK', name: 'Emirates' },
      slices: [
        {
          origin: { code: 'LOS', cityName: 'Lagos' },
          destination: { code: 'DXB', cityName: 'Dubai' },
          departureLocal: '2026-12-01T10:25',
          arrivalLocal: '2026-12-01T20:40',
          stops: 0,
        },
      ],
      baggage: { carryOn: 1, checked: 2 },
      conditions: { refundable: false, changeable: true },
      airlineReference: 'ABC123',
    },
    flightCancellable: false,
    scheduleChange: null,
    hotel: null,
    package: null,
    tour: null,
    visa: null,
    bus: null,
    rental: null,
    addon: null,
    membership: null,
    cancellation: null,
    voucher: { code: 'ABCD-EFGH-JKMN-PQRS-TUVW', qrPayload: 'SUSKII-V1:x', redeemedAt: null },
    passengers: [{ firstName: 'Ada', lastName: 'Obi', document: { last3: '123' } }],
    documents: [
      {
        id: '0190f0aa-0000-7000-8000-000000000002',
        type: 'e_ticket',
        fileName: 'e-ticket-SUS-7KX2Q9.pdf',
      },
    ],
    refunds: [],
  } as unknown as BookingDto;

  it('describes the trip with keys the model can cite', () => {
    const facts = assistantBookingFacts(booking);
    expect(facts.map((fact) => fact.key)).toEqual([
      'booking.status',
      'booking.payment',
      'flight.1',
      'flight.baggage',
      'flight.conditions',
      'booking.documents',
    ]);
    expect(facts.find((fact) => fact.key === 'flight.1')?.text).toBe(
      'Flight 1: Lagos (LOS) to Dubai (DXB) with Emirates, departs 2026-12-01 10:25 and arrives 2026-12-01 20:40 (local times), direct.',
    );
    expect(facts.find((fact) => fact.key === 'booking.payment')?.text).toMatch(/1,245,000\.00/);
  });

  it('never carries names, contact details, references, codes or document numbers', () => {
    const text = JSON.stringify(assistantBookingFacts(booking));
    for (const secret of [
      'Ada',
      'Obi',
      'example.com',
      '78',
      'SUS-7KX2Q9',
      'ABC123',
      'ABCD-EFGH',
      'SUSKII-V1',
      '123',
      'e-ticket-SUS',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

class FakeProvider extends LlmProvider {
  readonly name = 'fake';
  readonly requests: LlmExtraction[] = [];
  constructor(private readonly reply: () => Promise<LlmResult>) {
    super();
  }
  extract(request: LlmExtraction): Promise<LlmResult> {
    this.requests.push(request);
    return this.reply();
  }
}

const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };
const faqs = [
  {
    id: 'faq-1',
    question: 'When will I get my refund?',
    answer: 'Card refunds arrive within 5 to 10 working days.',
  },
];

describe('SupportAnswerer (ADR-085)', () => {
  it('scrubs the message, asks for structured output and passes a checked answer through', async () => {
    const provider = new FakeProvider(() =>
      Promise.resolve({
        output: answer('Card refunds arrive within 5 to 10 working days.', ['faq-1']),
        usage,
        model: 'm',
      }),
    );
    const outcome = await new SupportAnswerer(provider).answer({
      faqs,
      facts: [],
      messages: ['Refund? I am ada@example.com, +2348012345678'],
    });
    expect(outcome).toMatchObject({ kind: 'answer', sources: ['faq-1'] });
    const [request] = provider.requests;
    expect(request?.purpose).toBe('support-answer');
    expect(request?.input).not.toContain('ada@example.com');
    expect(request?.input).not.toContain('8012345678');
    expect(request?.system).toContain('[faq-1] Q: When will I get my refund?');
  });

  it('hands over on invalid output, failed checks and provider errors', async () => {
    const run = (reply: () => Promise<LlmResult>) =>
      new SupportAnswerer(new FakeProvider(reply)).answer({
        faqs,
        facts: [],
        messages: ['refund?'],
      });
    expect(
      await run(() => Promise.resolve({ output: { nope: true }, usage, model: 'm' })),
    ).toMatchObject({
      kind: 'handover',
      reason: 'invalid_output',
    });
    expect(
      await run(() =>
        Promise.resolve({
          output: answer('Refunds arrive in 2 days.', ['faq-1']),
          usage,
          model: 'm',
        }),
      ),
    ).toMatchObject({ kind: 'handover', reason: 'figure_not_in_sources' });
    expect(await run(() => Promise.reject(new LlmError('timeout')))).toMatchObject({
      kind: 'handover',
      reason: 'timeout',
    });
  });

  it('asks nothing when scrubbing leaves nothing', async () => {
    const provider = new FakeProvider(() => Promise.reject(new Error('not called')));
    const answerer = new SupportAnswerer(provider);
    expect(answerer.prepare({ faqs, facts: [], messages: ['ada@example.com'] })).toBeNull();
    expect(await answerer.answer({ faqs, facts: [], messages: ['  '] })).toMatchObject({
      kind: 'handover',
      reason: 'nothing_to_answer',
    });
    expect(provider.requests).toHaveLength(0);
  });
});

describe('MockLlmProvider for the assistant', () => {
  const system = supportAssistantSystem([
    {
      id: 'faq-1',
      question: 'Can I pay in instalments?',
      answer: 'Eligible bookings show payment plans at checkout.',
    },
    { id: 'faq-2', question: 'How do I contact support?', answer: 'Use the Help page.' },
  ]);
  const ask = async (message: string) =>
    (
      await new MockLlmProvider().extract({
        purpose: 'support-answer',
        system,
        input: `Booking facts: none.\n\nMessage: ${message}`,
        schema: {},
        maxOutputTokens: 100,
      })
    ).output;

  it('answers with the matching FAQ and cites it', async () => {
    expect(await ask('Can I pay for this trip in instalments?')).toEqual({
      answerable: true,
      answer: 'Eligible bookings show payment plans at checkout.',
      sources: ['faq-1'],
    });
  });

  it('is not answerable without a match', async () => {
    expect(await ask('Was my card charged twice for the Lagos tour?')).toEqual({
      answerable: false,
      answer: '',
      sources: [],
    });
  });
});
