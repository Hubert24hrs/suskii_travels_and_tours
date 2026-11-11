import { getMessages } from '@suskii/i18n';
import type { Schemas } from '@suskii/api-client';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { assistantSession } from '../lib/assistant';
import { json, mockApi, renderWithApp, signedInSession } from '../test/app';

import { AssistantHistoryScreen, AssistantScreen } from './assistant-screen';

jest.mock('../config', () => ({
  appConfig: {
    apiBaseUrl: 'http://api.test',
    webBaseUrl: 'https://www.suskii.test',
    attestation: 'mock',
    playIntegrityProject: '',
  },
  webHost: () => 'www.suskii.test',
  CLIENT_ID: 'mobile-android/0.1.0',
}));

const m = getMessages('en-NG');
const ID = '0192d3a0-7c1e-7b2a-9f00-00000000a001';
const RUN = '0192d3a0-7c1e-7b2a-9f00-00000000a101';
const CONFIRMATION = '0192d3a0-7c1e-7b2a-9f00-00000000a201';
const BOOKING = '0192d3a0-7c1e-7b2a-9f00-00000000a301';
const TOKEN = 'agent-token-abcdefghijklmnopqrstuvwxyz012345';
const params = useLocalSearchParams as jest.Mock;

type Message = Schemas['AgentMessage'];
type Conversation = Schemas['AgentConversation'];

const message = (patch: Partial<Message> = {}): Message => ({
  id: '0192d3a0-7c1e-7b2a-9f00-00000000a401',
  role: 'user',
  kind: 'text',
  agent: null,
  text: 'Can I change my flight to Abuja?',
  notice: null,
  cards: [],
  confirmationId: null,
  feedback: null,
  createdAt: '2026-11-11T09:00:00.000Z',
  ...patch,
});

const answer = (patch: Partial<Message> = {}): Message =>
  message({
    id: '0192d3a0-7c1e-7b2a-9f00-00000000a402',
    role: 'assistant',
    agent: 'bookings',
    text: 'Your fare allows a change for a fee.',
    createdAt: '2026-11-11T09:00:05.000Z',
    ...patch,
  });

const conversation = (patch: Partial<Conversation> = {}): Conversation => ({
  id: ID,
  reference: 'A-7Q2M4K',
  locale: 'en-NG',
  currency: 'NGN',
  status: 'open',
  bookingId: null,
  messageCount: 0,
  activeRunId: null,
  lastMessageAt: '2026-11-11T09:00:00.000Z',
  createdAt: '2026-11-11T09:00:00.000Z',
  messages: [],
  ...patch,
});

const available = () => json({ enabled: true, paused: false, available: true });

beforeEach(async () => {
  await assistantSession.remember(null);
});

afterEach(() => {
  params.mockReturnValue({});
  jest.mocked(router.push).mockClear();
});

describe('AssistantScreen', () => {
  it('says the assistant cannot answer while the API says it is not available', async () => {
    mockApi({
      'GET /v1/agent/status': () => json({ enabled: true, paused: true, available: false }),
    });
    await renderWithApp(<AssistantScreen />);

    expect(await screen.findByTestId('assistant-unavailable')).toBeOnTheScreen();
    expect(screen.getByText(m.assistant.notices.paused)).toBeOnTheScreen();
    expect(screen.queryByTestId('assistant-input')).toBeNull();
  });

  it('starts a guest conversation with the first message, proves the app and shows the answer', async () => {
    let reads = 0;
    const asked = message();
    const { calls } = mockApi({
      'GET /v1/agent/status': available,
      'POST /v1/attestation/challenges': () =>
        json({ challenge: 'challenge-1', expiresAt: '2026-11-11T09:05:00.000Z' }, 201),
      'POST /v1/agent/conversations': () =>
        json({ conversation: conversation(), accessToken: TOKEN }, 201),
      'POST /v1/agent/chat': () => json({ runId: RUN, message: asked }, 202),
      // The first read finds the run still answering; the next one has the answer.
      [`GET /v1/agent/conversations/${ID}`]: () => {
        reads += 1;
        return json(
          reads === 1
            ? conversation({ messages: [asked], activeRunId: RUN })
            : conversation({ messages: [asked, answer()] }),
        );
      },
    });
    await renderWithApp(<AssistantScreen />);

    // Nothing is started by opening the screen.
    expect(await screen.findByText(m.assistant.notices.greeting)).toBeOnTheScreen();
    expect(screen.getByText(m.assistant.disclosure)).toBeOnTheScreen();
    expect(calls.some((call) => call.url.endsWith('/v1/agent/conversations'))).toBe(false);

    await fireEvent.changeText(screen.getByTestId('assistant-input'), asked.text);
    await fireEvent.press(screen.getByTestId('assistant-send'));

    expect(await screen.findByText(asked.text)).toBeOnTheScreen();
    expect(
      await screen.findByText('Your fare allows a change for a fee.', {}, { timeout: 8_000 }),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('assistant-thinking')).toBeNull();

    const started = calls.find((call) => call.url.endsWith('/v1/agent/conversations'));
    expect(started?.headers.get('X-Suskii-Attestation')).toBeTruthy();
    expect(await started?.json()).toMatchObject({ locale: 'en-NG', turnstileToken: null });
    const chat = calls.find((call) => call.url.endsWith('/v1/agent/chat'));
    expect(chat?.headers.get('X-Agent-Token')).toBe(TOKEN);
    expect(await chat?.json()).toEqual({ conversationId: ID, text: asked.text });
    // The token and the open conversation stay on this device, in the secure store.
    expect(await assistantSession.headers(ID)).toEqual({ 'X-Agent-Token': TOKEN });
    expect(await assistantSession.current()).toBe(ID);
  }, 15_000);

  it('shows a notice in words, an indicative price as one, and hands over to a person', async () => {
    await assistantSession.remember(ID);
    mockApi({
      'GET /v1/agent/status': available,
      [`GET /v1/agent/conversations/${ID}`]: () =>
        json(
          conversation({
            messages: [
              message(),
              answer({
                text: 'Here is what I found elsewhere.',
                cards: [
                  {
                    kind: 'price',
                    title: 'Lagoon View Hotel',
                    lines: ['Sample Hotels, 2026-11-10 08:00 UTC'],
                    price: { amountMinor: 18_500_000, currency: 'NGN' },
                    indicative: true,
                  },
                  { kind: 'source', title: 'Refund policy', lines: ['2026-11-01'] },
                ],
              }),
              answer({
                id: '0192d3a0-7c1e-7b2a-9f00-00000000a403',
                kind: 'notice',
                text: '',
                notice: 'cannot_answer',
              }),
              answer({
                id: '0192d3a0-7c1e-7b2a-9f00-00000000a404',
                kind: 'handover',
                text: 'I have passed this to the team.',
              }),
            ],
          }),
        ),
    });
    await renderWithApp(<AssistantScreen />);

    expect(await screen.findByText('Lagoon View Hotel')).toBeOnTheScreen();
    expect(screen.getByText(m.assistant.cards.indicative)).toBeOnTheScreen();
    expect(screen.getByText(m.assistant.cards.indicativeNote)).toBeOnTheScreen();
    expect(screen.getByText(m.assistant.cards.source)).toBeOnTheScreen();
    expect(screen.getByText(m.assistant.notices.cannot_answer)).toBeOnTheScreen();
    expect(screen.getByText(m.assistant.handover)).toBeOnTheScreen();

    await fireEvent.press(screen.getByText(m.assistant.openSupport));
    expect(router.push).toHaveBeenCalledWith('/support');
    await fireEvent.press(screen.getByTestId('assistant-person'));
    expect(router.push).toHaveBeenCalledTimes(2);
  });

  it('changes nothing until the traveller confirms, and sends the tap with an idempotency key', async () => {
    await assistantSession.remember(ID);
    const pending: Schemas['AgentConfirmation'] = {
      id: CONFIRMATION,
      conversationId: ID,
      action: 'bookings.cancel',
      status: 'pending',
      reason: null,
      card: {
        kind: 'booking',
        title: 'Lagos to Abuja, 12 December',
        lines: ['One traveller'],
        amounts: [
          { code: 'refund', amount: { amountMinor: 4_500_000, currency: 'NGN' } },
          { code: 'kept', amount: { amountMinor: 500_000, currency: 'NGN' } },
        ],
        ref: { type: 'booking', id: BOOKING },
      },
      expiresAt: '2026-11-11T09:15:00.000Z',
      decidedAt: null,
    };
    const { calls } = mockApi({
      'GET /v1/agent/status': available,
      [`GET /v1/agent/conversations/${ID}`]: () =>
        json(
          conversation({
            messages: [message(), answer({ text: '', confirmationId: CONFIRMATION })],
          }),
        ),
      [`GET /v1/agent/confirmations/${CONFIRMATION}`]: () => json(pending),
      [`POST /v1/agent/confirmations/${CONFIRMATION}/confirm`]: () =>
        json({
          confirmation: { ...pending, status: 'confirmed', decidedAt: '2026-11-11T09:02:00.000Z' },
          runId: RUN,
        }),
    });
    await renderWithApp(<AssistantScreen />, await signedInSession());

    expect(await screen.findByText(m.assistant.confirm.actions.bookings_cancel)).toBeOnTheScreen();
    expect(screen.getByText('Lagos to Abuja, 12 December')).toBeOnTheScreen();
    expect(screen.getByText(m.assistant.confirm.amounts.refund)).toBeOnTheScreen();
    expect(screen.getByText(m.assistant.confirm.amounts.kept)).toBeOnTheScreen();
    expect(screen.getByText(m.assistant.confirm.note, { exact: false })).toBeOnTheScreen();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    await fireEvent.press(screen.getByTestId('assistant-confirm'));

    expect(await screen.findByText(m.assistant.confirm.statuses.confirmed)).toBeOnTheScreen();
    const tap = calls.find((call) => call.url.endsWith('/confirm'));
    expect(tap?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.queryByTestId('assistant-confirm')).toBeNull();
  });

  it('shows a preference to remember by its name and value, and says it was remembered (ADR-105)', async () => {
    await assistantSession.remember(ID);
    const pending: Schemas['AgentConfirmation'] = {
      id: CONFIRMATION,
      conversationId: ID,
      action: 'memory.remember',
      status: 'pending',
      reason: null,
      // The key and the value arrive as codes; the app puts both into words.
      card: { kind: 'link', title: 'cabin', lines: ['premium_economy'], amounts: [] },
      expiresAt: '2026-11-11T09:15:00.000Z',
      decidedAt: null,
    };
    mockApi({
      'GET /v1/agent/status': available,
      [`GET /v1/agent/conversations/${ID}`]: () =>
        json(
          conversation({
            messages: [message(), answer({ text: '', confirmationId: CONFIRMATION })],
          }),
        ),
      [`GET /v1/agent/confirmations/${CONFIRMATION}`]: () => json(pending),
      [`POST /v1/agent/confirmations/${CONFIRMATION}/confirm`]: () =>
        json({
          confirmation: { ...pending, status: 'confirmed', decidedAt: '2026-11-11T09:02:00.000Z' },
          runId: RUN,
        }),
    });
    await renderWithApp(<AssistantScreen />, await signedInSession());

    expect(await screen.findByText(m.assistant.confirm.actions.memory_remember)).toBeOnTheScreen();
    expect(
      screen.getByText(`${m.assistant.memory.keys.cabin}: ${m.cabins.premium_economy}`),
    ).toBeOnTheScreen();
    expect(screen.queryByText('premium_economy')).toBeNull();

    await fireEvent.press(screen.getByTestId('assistant-confirm'));
    expect(await screen.findByText(m.assistant.memory.remembered)).toBeOnTheScreen();
    // Not the words for a booking that changed.
    expect(screen.queryByText(m.assistant.confirm.statuses.confirmed)).toBeNull();
  });

  it('asks how the conversation went once the assistant has answered, and sends the score', async () => {
    await assistantSession.remember(ID);
    await assistantSession.saveToken(ID, TOKEN);
    const { calls } = mockApi({
      'GET /v1/agent/status': available,
      [`GET /v1/agent/conversations/${ID}`]: () =>
        json(conversation({ messages: [message(), answer()] })),
      [`PUT /v1/agent/conversations/${ID}/rating`]: () =>
        json(conversation({ messages: [message(), answer()], rating: 4 })),
    });
    await renderWithApp(<AssistantScreen />);

    expect(await screen.findByText(m.assistant.rating.question)).toBeOnTheScreen();
    expect(screen.queryByTestId('assistant-rating-thanks')).toBeNull();
    await fireEvent.press(
      screen.getByRole('radio', { name: m.assistant.rating.score.replace('{score}', '4') }),
    );

    expect(await screen.findByTestId('assistant-rating-thanks')).toBeOnTheScreen();
    expect(screen.getByTestId('assistant-rating-4')).toBeChecked();
    const rated = calls.find((call) => call.url.endsWith('/rating'));
    expect(await rated?.json()).toEqual({ score: 4 });
    expect(rated?.headers.get('X-Agent-Token')).toBe(TOKEN);
    // What the assistant remembers is for accounts: a guest is not offered the screen.
    expect(screen.queryByTestId('assistant-preferences')).toBeNull();
  });

  it('asks nothing about a conversation the assistant has not answered in', async () => {
    await assistantSession.remember(ID);
    mockApi({
      'GET /v1/agent/status': available,
      [`GET /v1/agent/conversations/${ID}`]: () => json(conversation({ messages: [message()] })),
    });
    await renderWithApp(<AssistantScreen />, await signedInSession());

    expect(await screen.findByText(message().text)).toBeOnTheScreen();
    expect(screen.queryByTestId('assistant-rating')).toBeNull();
    await fireEvent.press(screen.getByTestId('assistant-preferences'));
    expect(router.push).toHaveBeenCalledWith('/assistant/preferences');
  });

  it('tells a traveller whose asked-for conversation is gone, without starting another', async () => {
    params.mockReturnValue({ conversation: ID });
    const { calls } = mockApi({
      'GET /v1/agent/status': available,
      [`GET /v1/agent/conversations/${ID}`]: () =>
        json({ type: 'urn:suskii:problem:not-found', title: 'Not found', status: 404 }, 404),
    });
    await renderWithApp(<AssistantScreen />);

    expect(await screen.findByTestId('assistant-missing')).toBeOnTheScreen();
    expect(screen.getByText(m.assistant.errors.gone)).toBeOnTheScreen();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });
});

describe('AssistantHistoryScreen', () => {
  it("lists an account's conversations and opens one", async () => {
    mockApi({
      'GET /v1/agent/conversations': () =>
        json({
          conversations: [
            {
              id: ID,
              reference: 'A-7Q2M4K',
              status: 'open',
              messageCount: 4,
              lastMessageAt: '2026-11-11T09:30:00.000Z',
              createdAt: '2026-11-11T09:00:00.000Z',
            },
          ],
        }),
    });
    await renderWithApp(<AssistantHistoryScreen />, await signedInSession());

    await fireEvent.press(await screen.findByTestId(`assistant-conversation-${ID}`));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/assistant?conversation=${ID}`));
  });

  it('asks a guest to sign in, and reads nothing', async () => {
    const { calls } = mockApi({});
    await renderWithApp(<AssistantHistoryScreen />);

    expect(await screen.findByTestId('assistant-history-guest')).toBeOnTheScreen();
    expect(calls).toHaveLength(0);
  });
});
