import { getMessages } from '@suskii/i18n';
import type { Schemas } from '@suskii/api-client';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { supportTokens } from '../lib/support';
import { tripStore } from '../lib/trips';
import { json, mockApi, renderWithApp, signedInSession } from '../test/app';

import { SupportConversationScreen, SupportScreen } from './support-screen';

jest.mock('../config', () => ({
  appConfig: { apiBaseUrl: 'http://api.test', attestation: 'mock', playIntegrityProject: '' },
  CLIENT_ID: 'mobile-android/0.1.0',
}));

const m = getMessages('en-NG');
const ID = '0192d3a0-7c1e-7b2a-9f00-00000000e001';
const BOOKING = '0192d3a0-7c1e-7b2a-9f00-00000000e101';
const TOKEN = 'support-token-abcdefghijklmnopqrstuvwxyz0123';
const params = useLocalSearchParams as jest.Mock;

const message = (patch: Partial<Schemas['SupportMessage']> = {}): Schemas['SupportMessage'] => ({
  id: '0192d3a0-7c1e-7b2a-9f00-00000000e201',
  author: 'customer',
  kind: 'text',
  text: 'Can I change the date of my tour?',
  createdAt: '2026-10-28T09:00:00.000Z',
  ...patch,
});

const conversation = (
  patch: Partial<Schemas['SupportConversation']> = {},
): Schemas['SupportConversation'] => ({
  id: ID,
  reference: 'S-7Q2M4K',
  category: 'booking_change',
  status: 'open',
  booking: null,
  lastMessageAt: '2026-10-28T09:00:00.000Z',
  unread: false,
  createdAt: '2026-10-28T09:00:00.000Z',
  messages: [message()],
  ...patch,
});

const home = { hero: null, prime: null, whyBook: null, faqs: [] };

afterEach(() => {
  params.mockReturnValue({});
  jest.mocked(router.push).mockClear();
});

describe('SupportScreen', () => {
  it('starts a guest conversation with device attestation and keeps its token', async () => {
    const { calls } = mockApi({
      'GET /v1/content/home': () =>
        json({ ...home, faqs: [{ id: 'f1', question: 'Can I pay later?', answer: 'Yes.' }] }),
      'POST /v1/attestation/challenges': () =>
        json({ challenge: 'challenge-1', expiresAt: '2026-10-28T09:05:00.000Z' }, 201),
      'POST /v1/support/conversations': () =>
        json({ conversation: conversation(), accessToken: TOKEN }, 201),
    });
    await renderWithApp(<SupportScreen />);

    expect(await screen.findByText('Can I pay later?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('support-category-booking_change'));
    await fireEvent.changeText(
      screen.getByTestId('support-message'),
      'Can I change the date of my tour?',
    );
    await fireEvent.changeText(screen.getByTestId('support-email'), ' ada@example.com ');
    await fireEvent.press(screen.getByTestId('support-submit'));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/support/${ID}`));
    const start = calls.find((call) => call.url.endsWith('/v1/support/conversations'));
    expect(start?.headers.get('X-Suskii-Attestation')).toBeTruthy();
    expect(await start?.json()).toMatchObject({
      category: 'booking_change',
      message: 'Can I change the date of my tour?',
      email: 'ada@example.com',
      bookingId: null,
    });
    expect(await supportTokens.headers(ID)).toEqual({ 'X-Support-Token': TOKEN });
  });

  it("asks about a guest's booking with its booking token and says when an email is needed", async () => {
    params.mockReturnValue({ booking: BOOKING });
    const { calls } = mockApi({
      'GET /v1/content/home': () => json(home),
      'POST /v1/attestation/challenges': () =>
        json({ challenge: 'challenge-1', expiresAt: '2026-10-28T09:05:00.000Z' }, 201),
      'POST /v1/support/conversations': () =>
        json(
          {
            type: 'https://errors.suskii.example/support-email-required',
            title: 'Email required',
            status: 422,
          },
          422,
        ),
    });
    await renderWithApp(<SupportScreen />);
    await tripStore.addGuestTrip(BOOKING, 'guest-booking-token-abcdefghijklmnop');

    await fireEvent.changeText(await screen.findByTestId('support-message'), 'Is my hotel paid?');
    await fireEvent.press(screen.getByTestId('support-submit'));

    expect(await screen.findByText(m.support.errors.email)).toBeOnTheScreen();
    const start = calls.find((call) => call.url.endsWith('/v1/support/conversations'));
    expect(start?.headers.get('X-Booking-Token')).toBe('guest-booking-token-abcdefghijklmnop');
    expect(await start?.json()).toMatchObject({ category: 'booking_change', bookingId: BOOKING });
    expect(router.push).not.toHaveBeenCalled();
  });

  it("lists an account's conversations without asking for an email or attestation", async () => {
    const { calls } = mockApi({
      'GET /v1/content/home': () => json(home),
      'GET /v1/support/conversations': () =>
        json({
          conversations: [
            {
              id: ID,
              reference: 'S-7Q2M4K',
              category: 'payment',
              status: 'waiting',
              booking: null,
              lastMessageAt: '2026-10-28T09:30:00.000Z',
              unread: true,
              createdAt: '2026-10-28T09:00:00.000Z',
            },
          ],
        }),
    });
    await renderWithApp(<SupportScreen />, await signedInSession());

    expect(
      await screen.findByText(m.support.conversation.title.replace('{reference}', 'S-7Q2M4K')),
    ).toBeOnTheScreen();
    expect(screen.getByText(m.support.unread)).toBeOnTheScreen();
    expect(screen.getByText(m.support.status.waiting)).toBeOnTheScreen();
    expect(screen.queryByTestId('support-email')).toBeNull();
    await fireEvent.press(screen.getByTestId(`support-conversation-${ID}`));
    expect(router.push).toHaveBeenCalledWith(`/support/${ID}`);
    expect(calls.some((call) => call.url.includes('/attestation/'))).toBe(false);
  });
});

describe('SupportConversationScreen', () => {
  it('shows the thread, marks a new reply read and sends with the guest token', async () => {
    params.mockReturnValue({ id: ID });
    await supportTokens.save(ID, TOKEN);
    const staff = message({
      id: '0192d3a0-7c1e-7b2a-9f00-00000000e202',
      author: 'staff',
      text: 'Yes, which date would you like?',
      createdAt: '2026-10-28T09:10:00.000Z',
    });
    const mine = message({
      id: '0192d3a0-7c1e-7b2a-9f00-00000000e203',
      text: 'The 14th, please.',
      createdAt: '2026-10-28T09:12:00.000Z',
    });
    const { calls } = mockApi({
      [`GET /v1/support/conversations/${ID}`]: () =>
        json(conversation({ status: 'waiting', unread: true, messages: [message(), staff] })),
      [`PUT /v1/support/conversations/${ID}/read`]: () =>
        json(conversation({ status: 'waiting', messages: [message(), staff] })),
      [`POST /v1/support/conversations/${ID}/messages`]: () =>
        json(conversation({ messages: [message(), staff, mine] })),
    });
    await renderWithApp(<SupportConversationScreen />);

    expect(await screen.findByText('Yes, which date would you like?')).toBeOnTheScreen();
    expect(screen.getByTestId('support-status')).toHaveTextContent(m.support.status.waiting);
    expect(calls.some((call) => call.method === 'PUT')).toBe(true);
    expect(calls.every((call) => call.headers.get('X-Support-Token') === TOKEN)).toBe(true);

    await fireEvent.changeText(screen.getByTestId('support-reply'), 'The 14th, please.');
    await fireEvent.press(screen.getByTestId('support-send'));

    expect(await screen.findByText('The 14th, please.')).toBeOnTheScreen();
    const sent = calls.find((call) => call.method === 'POST');
    expect(await sent?.json()).toEqual({ message: 'The 14th, please.' });
    expect(screen.getByTestId('support-reply')).toHaveProp('value', '');
  });

  it("labels automated answers and shows the handover in the traveller's language", async () => {
    params.mockReturnValue({ id: ID });
    const answer = message({
      id: '0192d3a0-7c1e-7b2a-9f00-00000000e204',
      author: 'assistant',
      text: 'Tours can be cancelled from the booking page.',
      createdAt: '2026-10-28T09:00:05.000Z',
    });
    const handover = message({
      id: '0192d3a0-7c1e-7b2a-9f00-00000000e205',
      author: 'assistant',
      kind: 'handover',
      text: 'Our team is offline right now (English).',
      createdAt: '2026-10-28T09:01:00.000Z',
    });
    mockApi({
      [`GET /v1/support/conversations/${ID}`]: () =>
        json(conversation({ messages: [message(), answer, handover] })),
    });
    await renderWithApp(<SupportConversationScreen />, await signedInSession());

    expect(
      await screen.findByText('Tours can be cancelled from the booking page.'),
    ).toBeOnTheScreen();
    expect(screen.getAllByText(new RegExp(m.support.conversation.assistant))).toHaveLength(2);
    expect(screen.getByText(m.support.conversation.assistantNote)).toBeOnTheScreen();
    expect(screen.getByText(m.support.conversation.handover)).toBeOnTheScreen();
    expect(screen.queryByText('Our team is offline right now (English).')).toBeNull();
  });

  it('marks a conversation as solved', async () => {
    params.mockReturnValue({ id: ID });
    mockApi({
      [`GET /v1/support/conversations/${ID}`]: () => json(conversation()),
      [`POST /v1/support/conversations/${ID}/resolve`]: () =>
        json(conversation({ status: 'resolved' })),
    });
    await renderWithApp(<SupportConversationScreen />, await signedInSession());

    await fireEvent.press(await screen.findByTestId('support-resolve'));

    expect(await screen.findByText(m.support.conversation.resolved)).toBeOnTheScreen();
    expect(screen.getByTestId('support-status')).toHaveTextContent(m.support.status.resolved);
    expect(screen.queryByTestId('support-resolve')).toBeNull();
  });

  it('says so when the conversation cannot be opened', async () => {
    params.mockReturnValue({ id: ID });
    mockApi({
      [`GET /v1/support/conversations/${ID}`]: () =>
        json({ type: 'https://errors.suskii.example/not-found', status: 404 }, 404),
    });
    await renderWithApp(<SupportConversationScreen />);

    expect(await screen.findByTestId('support-missing')).toBeOnTheScreen();
  });
});
