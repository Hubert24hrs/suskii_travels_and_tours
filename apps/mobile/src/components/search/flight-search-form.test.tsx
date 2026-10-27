import type { Schemas } from '@suskii/api-client';
import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import { daysFromToday } from '../../lib/dates';
import { json, mockApi, offline, renderWithApp } from '../../test/app';

import { FlightSearchForm } from './flight-search-form';

const m = getMessages('en-NG');

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
  enugu: airport('ENU', 'Akanu Ibiam International Airport', 'Enugu'),
};

/** The catalog answers the first word typed, as the real place search does. */
const places = (request: Request) => {
  const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? '';
  const match = Object.entries(PLACES).find(([key]) => key.startsWith(q));
  return json({ items: match ? [match[1]] : [] });
};

/** A local calendar day as the pickers' test ids spell it. */
const dayId = (iso: string): string => `search-dates-day-${iso}`;

async function pick(testID: string, text: string, code: string): Promise<void> {
  await fireEvent.changeText(screen.getByTestId(testID), text);
  await fireEvent.press(await screen.findByTestId(`${testID}-option-${code}`));
}

describe('FlightSearchForm', () => {
  it('opens the date and traveller pickers and searches the trip (Lagos to Enugu)', async () => {
    mockApi({ 'GET /v1/catalog/places': places });
    await renderWithApp(<FlightSearchForm />);

    await pick('search-from', 'Lagos', 'LOS');
    await pick('search-to', 'Enugu', 'ENU');

    // Depart - Return opens its sheet; two taps choose the range.
    const depart = daysFromToday(14);
    const back = daysFromToday(21);
    await fireEvent.press(screen.getByTestId('search-dates'));
    const calendar = await screen.findByTestId('search-dates-sheet');
    await fireEvent.press(within(calendar).getByTestId(dayId(depart)));
    await fireEvent.press(within(calendar).getByTestId(dayId(back)));
    await fireEvent.press(screen.getByTestId('search-dates-done'));
    expect(screen.queryByTestId('search-dates-sheet')).toBeNull();

    // Travellers opens its sheet; add an adult and a child.
    await fireEvent.press(screen.getByTestId('search-travellers'));
    expect(await screen.findByTestId('search-travellers-sheet')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('search-travellers-adults-add'));
    await fireEvent.press(screen.getByTestId('search-travellers-children-add'));
    await fireEvent.press(screen.getByTestId('search-travellers-done'));

    await fireEvent.press(screen.getByTestId('search-submit'));
    const path = jest.mocked(router.push).mock.calls[0]?.[0];
    expect(path).toMatch(/^\/search\/flights\?/);
    expect(path).toContain('trip=round_trip');
    expect(path).toContain('from=LOS');
    expect(path).toContain('to=ENU');
    expect(path).toContain(`depart=${depart}`);
    expect(path).toContain(`return=${back}`);
    expect(path).toContain('adults=2');
    expect(path).toContain('children=1');
  });

  it('closes a picker from its close button and from the backdrop', async () => {
    mockApi({});
    await renderWithApp(<FlightSearchForm />);

    await fireEvent.press(screen.getByTestId('search-travellers'));
    await fireEvent.press(await screen.findByTestId('search-travellers-sheet-close'));
    expect(screen.queryByTestId('search-travellers-sheet')).toBeNull();

    await fireEvent.press(screen.getByTestId('search-dates'));
    // The backdrop is hidden from screen readers behind the modal sheet; they use Close.
    await fireEvent.press(
      await screen.findByTestId('search-dates-sheet-backdrop', { includeHiddenElements: true }),
    );
    expect(screen.queryByTestId('search-dates-sheet')).toBeNull();
  });

  it('says when places cannot load, and asks for a pick instead of "required"', async () => {
    mockApi({ 'GET /v1/catalog/places': offline });
    await renderWithApp(<FlightSearchForm />);

    await fireEvent.changeText(screen.getByTestId('search-from'), 'Lagos');
    expect(await screen.findByText(m.search.places.unavailable)).toBeOnTheScreen();
    expect(screen.queryByText(m.search.places.noResults)).toBeNull();

    await fireEvent.press(screen.getByTestId('search-submit'));
    expect(await screen.findByText(m.search.places.choose)).toBeOnTheScreen();
    expect(router.push).not.toHaveBeenCalled();
  });
});
