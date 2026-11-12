import type { AgentMessageDto } from '../chat/agent-chat.schemas';

import { AGENT_WHATSAPP_NOTES, whatsappText } from './agent-whatsapp.service';

const ORIGIN = 'https://www.suskii.test';

const message = (patch: Partial<AgentMessageDto> = {}): AgentMessageDto => ({
  id: '0192d3a0-7c1e-7b2a-9f00-00000000b001',
  role: 'assistant',
  kind: 'text',
  agent: 'flights',
  text: 'The first flight leaves at 06:45.',
  notice: null,
  cards: [],
  confirmationId: null,
  feedback: null,
  createdAt: '2026-11-11T09:00:00.000Z',
  ...patch,
});

describe('whatsappText', () => {
  it('is the answer, then each card as lines with its price and a full address', () => {
    const text = whatsappText(
      message({
        cards: [
          {
            kind: 'flight',
            title: 'Lagos to Abuja',
            lines: ['XY 101, 06:45 to 08:00'],
            price: { amountMinor: 8_550_000, currency: 'NGN' },
            href: '/flights',
          },
        ],
      }),
      ORIGIN,
    );
    expect(text).toBe(
      [
        'The first flight leaves at 06:45.',
        ['Lagos to Abuja', 'XY 101, 06:45 to 08:00', '₦85,500.00', `${ORIGIN}/flights`].join('\n'),
      ].join('\n\n'),
    );
  });

  it('never shows a price read elsewhere as one to book', () => {
    const text = whatsappText(
      message({
        cards: [
          {
            kind: 'price',
            title: 'Lagoon View Hotel',
            lines: ['Sample Hotels, 2026-11-10 08:00 UTC'],
            price: { amountMinor: 18_500_000, currency: 'NGN' },
            indicative: true,
          },
        ],
      }),
      ORIGIN,
    );
    expect(text).toContain('₦185,000.00 (indicative: seen elsewhere, not a price you can book)');
  });

  it('has words for a greeting and none for any other notice, a tap or an empty run', () => {
    expect(whatsappText(message({ kind: 'notice', text: '', notice: 'greeting' }), ORIGIN)).toMatch(
      /^Hello\./,
    );
    for (const notice of ['cannot_answer', 'limit', 'timeout', 'unavailable', 'paused'] as const) {
      expect(whatsappText(message({ kind: 'notice', text: '', notice }), ORIGIN)).toBeNull();
    }
    // A confirmation is tapped on the website or in the app, never agreed to in a chat.
    expect(
      whatsappText(
        message({ text: '', confirmationId: '0192d3a0-7c1e-7b2a-9f00-00000000b201' }),
        ORIGIN,
      ),
    ).toBeNull();
    expect(whatsappText(message({ text: '   ' }), ORIGIN)).toBeNull();
    expect(whatsappText(null, ORIGIN)).toBeNull();
  });

  it('keeps within one WhatsApp text: a card that does not fit whole is left out', () => {
    const card = (title: string) => ({
      kind: 'link' as const,
      title,
      lines: ['x'.repeat(150), 'y'.repeat(150)],
      href: '/hotels',
    });
    const text = whatsappText(
      message({ text: 'a'.repeat(3400), cards: [card('First'), card('Second')] }),
      ORIGIN,
    );
    expect(text).not.toBeNull();
    expect(text!.length).toBeLessThanOrEqual(3800);
    expect(text).toContain('First');
    expect(text).not.toContain('Second');
    // An answer longer than a text is cut, not sent in parts.
    expect(whatsappText(message({ text: 'b'.repeat(5000) }), ORIGIN)).toHaveLength(3800);
  });

  it('says what an answer must be read with, in words, whatever else has to go', () => {
    const note = { kind: 'note' as const, title: 'fare_trend', lines: [] };
    const page = { kind: 'link' as const, title: 'LOS → LHR', lines: [], href: '/flights/x' };
    expect(
      whatsappText(message({ text: 'Fares have been lower lately.', cards: [page, note] }), ORIGIN),
    ).toBe(
      [
        'Fares have been lower lately.',
        AGENT_WHATSAPP_NOTES.fare_trend,
        ['LOS → LHR', `${ORIGIN}/flights/x`].join('\n'),
      ].join('\n\n'),
    );
    expect(AGENT_WHATSAPP_NOTES.fare_trend).toMatch(/a trend, not a forecast/);
    expect(AGENT_WHATSAPP_NOTES.passport_reminder).toMatch(/not a decision about entry/);
    expect(AGENT_WHATSAPP_NOTES.visa_guidance).toMatch(/not a guarantee/);

    // The longest answer there is still leaves room for the note; the link card goes instead.
    const long = whatsappText(message({ text: 'c'.repeat(4000), cards: [page, note] }), ORIGIN);
    expect(long!.length).toBeLessThanOrEqual(3800);
    expect(long).toContain(AGENT_WHATSAPP_NOTES.fare_trend);
    expect(long).not.toContain('LOS → LHR');
    // A note this build does not know says nothing rather than its code.
    expect(
      whatsappText(
        message({ text: 'Hello.', cards: [{ kind: 'note', title: 'something_new', lines: [] }] }),
        ORIGIN,
      ),
    ).toBe('Hello.');
  });
});
