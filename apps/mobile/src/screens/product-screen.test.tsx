import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { json, mockApi, renderWithApp } from '../test/app';
import {
  FULL_DEPARTURE_ID,
  PACKAGE_DEPARTURE_ID,
  QUOTE_ID,
  inhouseQuote,
  packageDetail,
} from '../test/fixtures';

import { PackagesScreen } from './catalog-screen';
import { PackageScreen } from './product-screen';

const m = getMessages('en-NG');
const SLUG = packageDetail.slug;

describe('packages on mobile', () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ slug: SLUG });
  });

  it('lists packages with their from-price and opens one', async () => {
    mockApi({
      'GET /v1/packages': () =>
        json({
          packages: [
            {
              id: packageDetail.id,
              slug: SLUG,
              title: packageDetail.title,
              summary: packageDetail.summary,
              artKey: null,
              sample: true,
              featured: true,
              cityName: 'Zanzibar',
              countryCode: 'TZ',
              nights: 5,
              fromPrice: { amountMinor: 125_000_000, currency: 'NGN' },
              nextDeparture: '2026-11-14',
              departures: 2,
            },
          ],
        }),
    });
    await renderWithApp(<PackagesScreen />);

    const row = await screen.findByTestId(`product-${SLUG}`);
    expect(row).toHaveTextContent(/From ₦1,250,000 per adult/);
    expect(row).toHaveTextContent(m.inhouse.sample, { exact: false });
    await fireEvent.press(row);
    expect(router.push).toHaveBeenCalledWith(`/packages/${SLUG}`);
  });

  it('blocks dates without room for the group and quotes the chosen one for checkout', async () => {
    const { calls } = mockApi({
      [`GET /v1/packages/${SLUG}`]: () => json(packageDetail),
      'POST /v1/inhouse-quotes': () => json(inhouseQuote('package'), 201),
    });
    await renderWithApp(<PackageScreen />);

    // Two adults by default: the departure with one seat left cannot take them.
    const full = await screen.findByTestId(`departure-${FULL_DEPARTURE_ID}`);
    expect(full).toHaveTextContent(m.inhouse.book.notEnoughRoom, { exact: false });
    expect(full).toBeDisabled();
    expect(screen.getByTestId(`departure-${PACKAGE_DEPARTURE_ID}`)).toBeChecked();
    expect(screen.getByText(m.inhouse.detail.passportRequired)).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('product-book'));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/checkout/${QUOTE_ID}`));
    const quote = calls.find((request) => request.url.endsWith('/v1/inhouse-quotes'));
    expect(await quote?.json()).toEqual({
      kind: 'package',
      departureId: PACKAGE_DEPARTURE_ID,
      travellers: { adults: 2, children: 0, infants: 0 },
      currency: 'NGN',
    });
  });

  it('explains a date that filled up while the traveller was choosing', async () => {
    mockApi({
      [`GET /v1/packages/${SLUG}`]: () => json(packageDetail),
      'POST /v1/inhouse-quotes': () =>
        json({ type: 'urn:suskii:problem:sold-out', title: 'Sold out', status: 409 }, 409),
    });
    await renderWithApp(<PackageScreen />);
    await fireEvent.press(await screen.findByTestId('product-book'));

    expect(await screen.findByRole('alert')).toHaveTextContent(m.inhouse.book.errors.soldOut);
    expect(router.push).not.toHaveBeenCalled();
  });
});
