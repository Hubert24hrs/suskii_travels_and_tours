import type { Schemas } from '@suskii/api-client';
import { getMessages } from '@suskii/i18n';
import { GROUP_MAX_TRAVELLERS, GROUP_MIN_TRAVELLERS } from '@suskii/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import { daysFromToday } from '../lib/dates';
import { supportTokens } from '../lib/support';
import { json, mockApi, renderWithApp, signedInSession } from '../test/app';

import { GroupRequestScreen } from './group-request-screen';

jest.mock('../config', () => ({
  appConfig: { apiBaseUrl: 'http://api.test', attestation: 'mock', playIntegrityProject: '' },
  CLIENT_ID: 'mobile-android/0.1.0',
}));

const m = getMessages('en-NG');
const ID = '0192d3a0-7c1e-7b2a-9f00-00000000f001';
const TOKEN = 'support-token-abcdefghijklmnopqrstuvwxyz0123';

const airport = (code: string, name: string, cityName: string): Schemas['PlaceSuggestion'] => ({
  type: 'airport',
  code,
  name,
  cityId: null,
  cityName,
  countryCode: 'NG',
  countryName: 'Nigeria',
  timeZone: 'Africa/Lagos',
});
const PLACES: Record<string, Schemas['PlaceSuggestion']> = {
  lagos: airport('LOS', 'Murtala Muhammed International Airport', 'Lagos'),
  abuja: airport('ABV', 'Nnamdi Azikiwe International Airport', 'Abuja'),
};
const places = (request: Request) => {
  const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? '';
  const match = Object.entries(PLACES).find(([key]) => key.startsWith(q));
  return json({ items: match ? [match[1]] : [] });
};

const started = (): Schemas['StartedSupportConversation'] => ({
  conversation: {
    id: ID,
    reference: 'S-7Q2M4K',
    category: 'pre_booking',
    topic: 'group_booking',
    status: 'open',
    booking: null,
    lastMessageAt: '2026-11-10T09:00:00.000Z',
    unread: false,
    createdAt: '2026-11-10T09:00:00.000Z',
    messages: [],
  },
  accessToken: TOKEN,
});

async function pick(testID: string, text: string, code: string): Promise<void> {
  await fireEvent.changeText(screen.getByTestId(testID), text);
  await fireEvent.press(await screen.findByTestId(`${testID}-option-${code}`));
}

async function chooseDates(depart: string, back: string): Promise<void> {
  await fireEvent.press(screen.getByTestId('group-dates'));
  const calendar = await screen.findByTestId('group-dates-sheet');
  await fireEvent.press(within(calendar).getByTestId(`group-dates-day-${depart}`));
  await fireEvent.press(within(calendar).getByTestId(`group-dates-day-${back}`));
  await fireEvent.press(screen.getByTestId('group-dates-done'));
}

describe('GroupRequestScreen (ADR-093)', () => {
  it('checks the request on the device before anything is sent', async () => {
    const { calls } = mockApi({ 'GET /v1/catalog/places': places });
    await renderWithApp(<GroupRequestScreen />);

    // Nine travellers fit an ordinary booking: the form says what a group is.
    await fireEvent.changeText(screen.getByTestId('group-travellers'), '9');
    await fireEvent.press(screen.getByTestId('group-submit'));

    expect(
      await screen.findByText(
        m.groups.errors.travellers
          .replace('{min}', String(GROUP_MIN_TRAVELLERS))
          .replace('{max}', String(GROUP_MAX_TRAVELLERS)),
      ),
    ).toBeOnTheScreen();
    // No airports, no dates and, without an account, no email to reply to.
    expect(screen.getAllByText(m.search.issues.required).length).toBeGreaterThanOrEqual(3);
    expect(calls.some((call) => call.url.includes('/group-requests'))).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('sends a guest request with device attestation and opens the conversation', async () => {
    const { calls } = mockApi({
      'GET /v1/catalog/places': places,
      'POST /v1/attestation/challenges': () =>
        json({ challenge: 'challenge-1', expiresAt: '2026-11-10T09:05:00.000Z' }, 201),
      'POST /v1/flights/group-requests': () => json(started(), 201),
    });
    await renderWithApp(<GroupRequestScreen />);

    const depart = daysFromToday(40);
    const back = daysFromToday(47);
    await pick('group-from', 'Lagos', 'LOS');
    await pick('group-to', 'Abuja', 'ABV');
    await chooseDates(depart, back);
    await fireEvent.changeText(screen.getByTestId('group-travellers'), '25');
    await fireEvent.changeText(screen.getByTestId('group-organisation'), 'Unity Choir');
    await fireEvent.changeText(screen.getByTestId('group-notes'), 'Two wheelchair users.');
    await fireEvent.changeText(screen.getByTestId('group-email'), ' choir@example.com ');
    await fireEvent.press(screen.getByTestId('group-submit'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/support/${ID}`));
    const request = calls.find((call) => call.url.endsWith('/v1/flights/group-requests'));
    expect(request?.headers.get('X-Suskii-Attestation')).toBeTruthy();
    expect(await request?.json()).toEqual({
      tripType: 'round_trip',
      origin: 'LOS',
      destination: 'ABV',
      departureDate: depart,
      returnDate: back,
      travellers: 25,
      cabinClass: 'economy',
      organisation: 'Unity Choir',
      notes: 'Two wheelchair users.',
      email: 'choir@example.com',
      turnstileToken: null,
    });
    // The guest's token stays in the secure store, so the conversation opens on this phone.
    expect(await supportTokens.headers(ID)).toEqual({ 'X-Support-Token': TOKEN });
  });

  it('asks a signed-in traveller for no email and says when five conversations are open', async () => {
    const { calls } = mockApi({
      'GET /v1/catalog/places': places,
      'POST /v1/flights/group-requests': () =>
        json({ type: 'urn:suskii:problem:support-limit', title: 'Limit', status: 409 }, 409),
    });
    await renderWithApp(<GroupRequestScreen />, await signedInSession());

    expect(screen.queryByTestId('group-email')).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: m.groups.oneWay }));
    await pick('group-from', 'Lagos', 'LOS');
    await pick('group-to', 'Abuja', 'ABV');
    const depart = daysFromToday(40);
    await fireEvent.press(screen.getByTestId('group-dates'));
    const calendar = await screen.findByTestId('group-dates-sheet');
    await fireEvent.press(within(calendar).getByTestId(`group-dates-day-${depart}`));
    await fireEvent.press(screen.getByTestId('group-dates-done'));
    await fireEvent.changeText(screen.getByTestId('group-travellers'), '12');
    await fireEvent.press(screen.getByTestId('group-submit'));

    expect(await screen.findByText(m.support.errors.limit)).toBeOnTheScreen();
    const request = calls.find((call) => call.url.endsWith('/v1/flights/group-requests'));
    // An account needs no device proof and no email: the API knows who is asking.
    expect(request?.headers.get('X-Suskii-Attestation')).toBeNull();
    expect(await request?.json()).toMatchObject({
      tripType: 'one_way',
      returnDate: null,
      travellers: 12,
      email: null,
    });
    expect(router.replace).not.toHaveBeenCalled();
  });
});
