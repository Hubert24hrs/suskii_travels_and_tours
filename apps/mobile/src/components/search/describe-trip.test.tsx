import type { Schemas } from '@suskii/api-client';
import { getMessages } from '@suskii/i18n';
import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { daysFromToday } from '../../lib/dates';
import { json, mockApi, offline, renderWithApp } from '../../test/app';

import { FlightSearchForm } from './flight-search-form';

const m = getMessages('en-NG');
const ROUTE = '/v1/flights/natural-search';
const status = { enabled: true, maxLength: 280 } satisfies Schemas['NaturalSearchStatus'];
const problem = (slug: string, statusCode: number) =>
  json({ type: `urn:suskii:problem:${slug}`, title: slug, status: statusCode }, statusCode);

function parsed(departureDate: string): Schemas['NaturalSearchResult'] {
  return {
    draft: {
      tripType: 'one_way',
      origin: 'LOS',
      destination: 'ABV',
      departureDate,
      returnDate: '',
      legs: [],
      travellers: { adults: 2, children: 0, infants: 0 },
      cabinClass: 'business',
      directOnly: false,
      flexibleDates: false,
    },
    places: [
      {
        code: 'LOS',
        name: 'Murtala Muhammed International Airport',
        city: 'Lagos',
        countryCode: 'NG',
      },
      {
        code: 'ABV',
        name: 'Nnamdi Azikiwe International Airport',
        city: 'Abuja',
        countryCode: 'NG',
      },
    ],
    departureMonth: null,
    missing: [],
  };
}

async function describe_(text: string): Promise<void> {
  // The box opens from a button, so the form stays where it was until the traveller asks.
  await fireEvent.press(await screen.findByRole('button', { name: m.search.describe.open }));
  await fireEvent.changeText(screen.getByTestId('describe-trip-text'), text);
  await fireEvent.press(screen.getByTestId('describe-trip-submit'));
}

describe('Describe your trip (AI trip search)', () => {
  it('fills the flight form, which the traveller then searches as usual', async () => {
    const depart = daysFromToday(20);
    const { calls } = mockApi({
      [`GET ${ROUTE}`]: () => json(status),
      [`POST ${ROUTE}`]: () => json(parsed(depart)),
    });
    await renderWithApp(<FlightSearchForm />);

    await describe_(`Lagos to Abuja on ${depart}, 2 adults, business`);

    expect(await screen.findByText(m.search.describe.filled)).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Lagos (LOS)')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Abuja (ABV)')).toBeOnTheScreen();
    expect(router.push).not.toHaveBeenCalled();

    const sent = calls.find((call) => call.method === 'POST');
    expect(await sent?.json()).toEqual({
      text: `Lagos to Abuja on ${depart}, 2 adults, business`,
      timeZone: 'Africa/Lagos',
    });

    await fireEvent.press(screen.getByTestId('search-submit'));
    const path = jest.mocked(router.push).mock.calls[0]?.[0];
    expect(path).toMatch(/^\/search\/flights\?/);
    expect(path).toContain('trip=one_way');
    expect(path).toContain('from=LOS');
    expect(path).toContain('to=ABV');
    expect(path).toContain(`depart=${depart}`);
    expect(path).toContain('adults=2');
    expect(path).toContain('cabin=business');
  });

  it('names what it could not tell, and the month the traveller mentioned', async () => {
    mockApi({
      [`GET ${ROUTE}`]: () => json(status),
      [`POST ${ROUTE}`]: () =>
        json({
          ...parsed(''),
          departureMonth: '2026-12',
          missing: ['departureDate'],
        }),
    });
    await renderWithApp(<FlightSearchForm />);

    await describe_('Lagos to Abuja in December');

    const notice = await screen.findByTestId('describe-trip-notice');
    expect(notice).toHaveTextContent(m.search.describe.fields.departureDate, { exact: false });
    expect(notice).toHaveTextContent('December 2026', { exact: false });
  });

  it.each([
    [
      'not understood',
      () => problem('ai-search-not-understood', 422),
      m.search.describe.notUnderstood,
    ],
    [
      'over the daily cap',
      () => problem('ai-search-budget-exceeded', 429),
      m.search.describe.overLimit,
    ],
    ['rate limited', () => problem('rate-limited', 429), m.search.describe.overLimit],
    ['unavailable', () => problem('ai-search-unavailable', 503), m.search.describe.unavailable],
    ['offline', offline, m.search.describe.unavailable],
  ])('falls back to the form when %s, keeping the text', async (_case, answer, message) => {
    mockApi({ [`GET ${ROUTE}`]: () => json(status), [`POST ${ROUTE}`]: answer });
    await renderWithApp(<FlightSearchForm />);

    await describe_('tell me a joke');

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByDisplayValue('tell me a joke')).toBeOnTheScreen();
  });

  it('asks for a few words before calling the API', async () => {
    const { calls } = mockApi({ [`GET ${ROUTE}`]: () => json(status) });
    await renderWithApp(<FlightSearchForm />);

    await describe_('ab');

    expect(await screen.findByRole('alert')).toHaveTextContent(m.search.describe.tooShort);
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('stays hidden while the feature is off or the API cannot say', async () => {
    mockApi({ [`GET ${ROUTE}`]: () => json({ ...status, enabled: false }) });
    await renderWithApp(<FlightSearchForm />);
    expect(await screen.findByTestId('flight-search-form')).toBeOnTheScreen();
    expect(screen.queryByTestId('describe-trip-open')).toBeNull();

    mockApi({ [`GET ${ROUTE}`]: offline });
    await renderWithApp(<FlightSearchForm />);
    expect(screen.queryByTestId('describe-trip-open')).toBeNull();
  });
});
