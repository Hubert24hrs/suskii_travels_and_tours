import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { tripTitle, type TripComponent } from '@suskii/shared';
import { Badge, Button, Card } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import {
  chosenMethod,
  MethodChoice,
  type PaymentMethodName,
} from '../components/booking/payment-options';
import { Loading, Notice } from '../components/states';
import { useSensitiveScreen } from '../hooks/use-sensitive-screen';
import { isNetworkError, problemSlug } from '../lib/api';
import { attestationHeader } from '../lib/attestation';
import { openHostedCheckout } from '../lib/payment';
import { activeTrip, tripSearchPath } from '../lib/trip-builder';
import { useApp, useT } from '../providers/app-provider';

import { TRIP_STATE_VARIANT } from './trip-plan-screen';

type Trip = Schemas['Trip'];
type Part = Trip['parts'][number];
type Addon = Schemas['AddonCard'];
type Loaded = { kind: 'ready'; trip: Trip } | { kind: 'missing' };

const PART_VARIANT = {
  to_pay: 'info',
  paying: 'warning',
  paid: 'success',
  confirmed: 'success',
  closed: 'neutral',
} as const;

const POLL_MS = 2500;
const ADDON_TYPE = { transfer: 'airport_transfer', insurance: 'insurance' } as const;

/** Payment or fulfilment in flight: the webhook decides, this screen only watches. */
const shouldPoll = (trip: Trip): boolean =>
  trip.state === 'awaiting_payment' ||
  trip.parts.some((part) => part.state === 'paying' || part.state === 'paid');

/**
 * The transfers or the insurance on sale at the destination, each quoted for the trip's dates
 * and travellers and then checked out like any booking; checkout adds it to the trip.
 */
function AddonChoices({
  trip,
  component,
  onChosen,
}: {
  trip: Trip;
  component: 'transfer' | 'insurance';
  onChosen: (quoteId: string) => void;
}) {
  const { api, currency } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { plan } = trip;
  const addons = useQuery({
    queryKey: ['trip-addon-choices', component, plan.destination.cityId, currency],
    queryFn: async (): Promise<Addon[]> => {
      const { data } = await api.GET('/v1/addons', {
        params: {
          query: {
            currency,
            type: ADDON_TYPE[component],
            ...(plan.destination.cityId
              ? { cityId: plan.destination.cityId }
              : { countryCode: plan.destination.countryCode }),
          },
        },
      });
      return data?.addons ?? [];
    },
  });

  const add = async (addon: Addon) => {
    setBusy(addon.id);
    setError(null);
    try {
      const { data } = await api.POST('/v1/inhouse-quotes', {
        body: {
          kind: 'addon',
          addonId: addon.id,
          startDate: plan.departDate,
          endDate: plan.returnDate,
          travellers: { adults: plan.adults, children: plan.children, infants: 0 },
          linkToken: null,
          cityId: plan.destination.cityId,
          currency,
        },
      });
      if (data) onChosen(data.quoteId);
      else setError(t('addons.errors.unavailable'));
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(null);
    }
  };

  if (addons.isPending) return <Loading label={t('common.loading')} />;
  return (
    <View testID={`trip-addons-${component}`} className="gap-3">
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      {!addons.data || addons.data.length === 0 ? (
        <Text className="font-body text-body-sm text-foreground">{t('addons.none')}</Text>
      ) : (
        addons.data.map((addon) => (
          <View key={addon.id} className="gap-2 rounded-md border border-border p-3">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="flex-1 font-body-bold text-body text-heading">{addon.title}</Text>
              {addon.sample ? <Badge variant="neutral">{t('inhouse.sample')}</Badge> : null}
            </View>
            <Text className="font-body text-body-sm text-foreground">{addon.summary}</Text>
            <Text className="font-body-bold text-body-sm text-heading">
              {t(`addons.unitPrice.${addon.pricingBasis}`, {
                price: format.money(addon.unitPrice),
              })}
            </Text>
            <Button
              testID={`trip-addon-${addon.slug}`}
              variant="secondary"
              loading={busy === addon.id}
              disabled={busy !== null}
              onPress={() => void add(addon)}
            >
              {t('addons.add', { title: addon.title })}
            </Button>
          </View>
        ))
      )}
    </View>
  );
}

function BuiltTrip({ tripId }: { tripId: string }) {
  const { api, currency } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  useSensitiveScreen();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethodName | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [choosing, setChoosing] = useState<'transfer' | 'insurance' | null>(null);

  const query = useQuery({
    queryKey: ['built-trip', tripId],
    queryFn: async (): Promise<Loaded> => {
      const { data, response } = await api.GET('/v1/trips/{tripId}', {
        params: { path: { tripId } },
      });
      if (data) return { kind: 'ready', trip: data };
      if (response.status === 404 || response.status === 400) return { kind: 'missing' };
      throw new Error('trip unavailable');
    },
    refetchInterval: (current) =>
      current.state.data?.kind === 'ready' && shouldPoll(current.state.data.trip) ? POLL_MS : false,
  });
  const { refetch } = query;
  // Back from choosing a part (or from the provider's page): show the trip as it stands now.
  useFocusEffect(
    useCallback(() => {
      activeTrip.set(null);
      void refetch();
    }, [refetch]),
  );

  if (query.isPending) return <Loading label={t('common.loading')} />;
  if (!query.data)
    return (
      <Notice
        body={isNetworkError(query.error) ? t('mobile.networkError') : t('trips.page.loadError')}
        action={t('trips.page.retry')}
        onAction={() => void refetch()}
      />
    );
  if (query.data.kind === 'missing')
    return <Notice testID="built-trip-missing" body={t('trips.page.missing')} />;

  const { trip } = query.data;
  const { plan } = trip;
  const partOf = (component: TripComponent): Part | undefined =>
    trip.parts.find((part) => part.component === component && part.state !== 'closed') ??
    trip.parts.find((part) => part.component === component);
  const live = trip.parts.filter((part) => part.state !== 'closed');
  const settled = live.some((part) => part.state === 'paid' || part.state === 'confirmed');
  const remember = (component: TripComponent) =>
    activeTrip.set({ id: trip.id, reference: trip.reference, component });

  /** The ordinary search for the part, or the add-ons on sale for a transfer or insurance. */
  const choose = (component: TripComponent) => {
    setError(null);
    if (component === 'transfer' || component === 'insurance') {
      setChoosing((current) => (current === component ? null : component));
      return;
    }
    remember(component);
    // Without a catalog city the traveller starts from Home's search card.
    router.push(tripSearchPath(plan, component) ?? '/');
  };

  const run = async (key: string, action: () => Promise<string | null>) => {
    setBusy(key);
    setError(null);
    try {
      const failed = await action();
      if (failed) setError(failed);
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(null);
      void refetch();
    }
  };

  const remove = (part: Part) =>
    run(part.booking.id, async () => {
      const { data, error: problem } = await api.DELETE('/v1/trips/{tripId}/parts/{bookingId}', {
        params: { path: { tripId: trip.id, bookingId: part.booking.id } },
      });
      if (data) return null;
      return t(
        problemSlug(problem) === 'trip-part-paid'
          ? 'trips.page.errors.partPaid'
          : 'trips.page.errors.generic',
      );
    });

  const acceptPrice = (part: Part) =>
    run(part.booking.id, async () => {
      if (!part.priceChange) return null;
      const { data } = await api.POST('/v1/bookings/{bookingId}/price-consent', {
        params: { path: { bookingId: part.booking.id } },
        body: { total: part.priceChange.current },
      });
      return data ? null : t('trips.page.errors.generic');
    });

  const pay = () =>
    run('pay', async () => {
      const attestation = await attestationHeader(api);
      const {
        data,
        error: problem,
        response,
      } = await api.POST('/v1/trips/{tripId}/payments', {
        params: {
          path: { tripId: trip.id },
          header: {
            'Idempotency-Key': randomUUID(),
            ...(attestation ? { 'X-Suskii-Attestation': attestation } : {}),
          },
        },
        body: { method: chosenMethod(trip.payment.methods, method) },
      });
      if (data) {
        // The provider's page in the system browser; the webhook decides, this screen polls.
        await openHostedCheckout(data.checkoutUrl);
        return null;
      }
      const slug = problemSlug(problem);
      if (slug === 'price-changed') return t('trips.page.errors.priceChanged');
      if (response.status === 410) return t('trips.page.errors.unavailable');
      if (slug === 'trip-nothing-to-pay') return t('trips.page.errors.nothingToPay');
      if (slug === 'attestation-required') return t('mobile.checkout.deviceCheckFailed');
      if (response.status === 429) return t('trips.page.errors.tooMany');
      if (
        slug === 'payment-provider-unavailable' ||
        slug === 'payment-method-unavailable' ||
        response.status === 503
      )
        return t('trips.page.errors.provider');
      return t('trips.page.errors.generic');
    });

  const deleteTrip = async () => {
    setBusy('delete');
    setError(null);
    try {
      const { response } = await api.DELETE('/v1/trips/{tripId}', {
        params: { path: { tripId: trip.id } },
      });
      if (response.ok) {
        router.back();
        return;
      }
      setError(
        t(response.status === 409 ? 'trips.page.errors.hasPayments' : 'trips.page.errors.generic'),
      );
    } catch {
      setError(t('mobile.networkError'));
    }
    setBusy(null);
    setConfirmDelete(false);
  };

  const describe = (part: Part): string => {
    const { flight, hotel, product } = part.booking;
    if (flight)
      return t('trips.page.flightLine', {
        from: flight.origin.cityName ?? flight.origin.code,
        to: flight.destination.cityName ?? flight.destination.code,
        airline: flight.airline,
      });
    if (hotel) return `${hotel.name}, ${hotel.cityName}`;
    return product?.title ?? part.booking.reference;
  };

  const travellers = [
    t('trips.adults', { count: plan.adults }),
    ...(plan.children > 0 ? [t('trips.children', { count: plan.children })] : []),
  ].join(', ');
  const open = trip.payment.open;

  return (
    <ScrollView
      testID="built-trip"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      <View className="gap-2">
        <Text accessibilityRole="header" className="font-heading-extrabold text-h3 text-heading">
          {t('trips.route', tripTitle(plan))}
        </Text>
        <Text className="font-body text-body-sm text-foreground">
          {format.dateRange(plan.departDate, plan.returnDate, 'weekday')}
          {' · '}
          {travellers}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <View testID="built-trip-state">
            <Badge variant={TRIP_STATE_VARIANT[trip.state]}>
              {t(`trips.states.${trip.state}`)}
            </Badge>
          </View>
          <Text className="font-body text-body-sm text-muted">
            {t('trips.page.reference', { reference: trip.reference })}
          </Text>
        </View>
      </View>

      {trip.state === 'paid' ? (
        <Text
          testID="built-trip-paid"
          className="rounded-md bg-primary-subtle p-4 font-body text-body-sm text-foreground"
        >
          {t('trips.page.paid')}
        </Text>
      ) : null}
      {trip.state === 'closed' ? (
        <Text className="font-body text-body-sm text-foreground">{t('trips.page.closed')}</Text>
      ) : null}
      {trip.currency !== currency && trip.state !== 'paid' && trip.state !== 'closed' ? (
        <Text
          testID="trip-currency-note"
          className="rounded-md border border-border-strong p-4 font-body text-body-sm text-foreground"
        >
          {t('trips.page.currencyNote', { currency: trip.currency })}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}

      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('trips.page.partsHeading')}
      </Text>
      {plan.components.map((component) => {
        const part = partOf(component);
        const label = t(`trips.components.${component}`);
        const empty = !part || part.state === 'closed';
        return (
          <View key={component} testID={`trip-part-${component}`}>
            <Card className="gap-3 p-4">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 gap-1">
                  <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
                    {label}
                  </Text>
                  {part ? (
                    <>
                      <Text className="font-body text-body text-foreground">{describe(part)}</Text>
                      <Text className="font-body text-body-sm text-muted">
                        {part.booking.endsOn
                          ? format.dateRange(part.booking.startsOn, part.booking.endsOn, 'medium')
                          : format.date(part.booking.startsOn, 'medium')}
                      </Text>
                    </>
                  ) : (
                    <Text className="font-body text-body-sm text-muted">
                      {t('trips.page.notAdded')}
                    </Text>
                  )}
                </View>
                {part ? (
                  <View className="items-end gap-2">
                    <Text
                      testID={`trip-price-${component}`}
                      className="font-body-bold text-body text-heading"
                    >
                      {format.money(part.booking.total)}
                    </Text>
                    <Badge variant={PART_VARIANT[part.state]}>
                      {t(`trips.partStates.${part.state}`)}
                    </Badge>
                  </View>
                ) : null}
              </View>
              {part?.priceChange && part.state !== 'closed' ? (
                <View
                  accessibilityRole="alert"
                  className="gap-2 rounded-md border border-border-strong p-3"
                >
                  <Text className="font-body text-body-sm text-foreground">
                    {t('trips.page.priceChanged', {
                      previous: format.money(part.priceChange.previous),
                      current: format.money(part.priceChange.current),
                    })}
                  </Text>
                  <Button
                    testID={`trip-accept-${component}`}
                    loading={busy === part.booking.id}
                    onPress={() => void acceptPrice(part)}
                  >
                    {t('trips.page.acceptPrice')}
                  </Button>
                </View>
              ) : null}
              {empty ? (
                <Button testID={`trip-choose-${component}`} onPress={() => choose(component)}>
                  {t(`trips.page.choose.${component}`)}
                </Button>
              ) : null}
              {empty && choosing === component ? (
                <AddonChoices
                  trip={trip}
                  component={component}
                  onChosen={(quoteId) => {
                    remember(component);
                    setChoosing(null);
                    router.push(`/checkout/${quoteId}` as Href);
                  }}
                />
              ) : null}
              {part ? (
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    testID={`trip-view-${component}`}
                    variant="ghost"
                    accessibilityLabel={t('trips.page.viewLabel', {
                      reference: part.booking.reference,
                    })}
                    onPress={() => router.push(`/trips/${part.booking.id}` as Href)}
                  >
                    {t('trips.page.viewBooking')}
                  </Button>
                  {part.state === 'to_pay' ? (
                    <Button
                      testID={`trip-remove-${component}`}
                      variant="ghost"
                      loading={busy === part.booking.id}
                      accessibilityLabel={t('trips.page.removeLabel', { part: label })}
                      onPress={() => void remove(part)}
                    >
                      {t('trips.page.remove')}
                    </Button>
                  ) : null}
                </View>
              ) : null}
            </Card>
          </View>
        );
      })}

      <Card className="gap-3 p-4">
        <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
          {t('trips.page.reviewHeading')}
        </Text>
        {live.length === 0 ? (
          <Text className="font-body text-body-sm text-foreground">
            {t('trips.page.nothingYet')}
          </Text>
        ) : (
          <View className="gap-2">
            {live.map((part) => (
              <View key={part.booking.id} className="flex-row justify-between gap-4">
                <Text className="flex-1 font-body text-body-sm text-foreground">
                  {t(`trips.components.${part.component}`)}
                </Text>
                <Text className="font-body text-body-sm text-foreground">
                  {format.money(part.booking.total)}
                </Text>
              </View>
            ))}
            <View className="flex-row justify-between gap-4 border-t border-border pt-2">
              <Text className="flex-1 font-body-bold text-body text-heading">
                {t('trips.page.total')}
              </Text>
              <Text testID="trip-total" className="font-heading text-h4 text-heading">
                {format.money(trip.total)}
              </Text>
            </View>
            {settled && trip.due.amountMinor > 0 ? (
              <View className="flex-row justify-between gap-4">
                <Text className="flex-1 font-body-bold text-body-sm text-foreground">
                  {t('trips.page.due')}
                </Text>
                <Text testID="trip-due" className="font-body-bold text-body-sm text-foreground">
                  {format.money(trip.due)}
                </Text>
              </View>
            ) : null}
          </View>
        )}
        {open ? (
          <>
            <Text className="font-body text-body-sm text-foreground">
              {t('trips.page.waiting')}
            </Text>
            <Button
              testID="trip-continue-payment"
              fullWidth
              onPress={() => void openHostedCheckout(open.checkoutUrl).then(() => refetch())}
            >
              {t('trips.page.continuePayment')}
            </Button>
          </>
        ) : trip.due.amountMinor > 0 ? (
          <>
            <MethodChoice methods={trip.payment.methods} value={method} onChange={setMethod} />
            <Button testID="trip-pay" fullWidth loading={busy === 'pay'} onPress={() => void pay()}>
              {t('trips.page.pay', { amount: format.money(trip.due) })}
            </Button>
            <Text className="font-body text-caption text-muted">{t('trips.page.payNote')}</Text>
          </>
        ) : trip.state === 'awaiting_payment' ? (
          <Text className="font-body text-body-sm text-foreground">{t('trips.page.waiting')}</Text>
        ) : null}
      </Card>

      {settled || open ? null : confirmDelete ? (
        <Card className="gap-3 p-4">
          <Text className="font-body text-body-sm text-foreground">
            {t('trips.page.deleteConfirm')}
          </Text>
          <Button
            testID="trip-delete-yes"
            loading={busy === 'delete'}
            onPress={() => void deleteTrip()}
          >
            {t('trips.page.deleteYes')}
          </Button>
          <Button variant="ghost" onPress={() => setConfirmDelete(false)}>
            {t('trips.page.deleteNo')}
          </Button>
        </Card>
      ) : (
        <Button testID="trip-delete" variant="ghost" onPress={() => setConfirmDelete(true)}>
          {t('trips.page.delete')}
        </Button>
      )}
    </ScrollView>
  );
}

/**
 * A combined trip (ADR-099): the parts the traveller asked for, each with its price, one total
 * and one payment. Every part is chosen on the ordinary search and checkout screens; this screen
 * remembers which part is being chosen, so checkout adds the booking here instead of taking
 * payment. Money on screen comes from the API; nothing is added up on the phone.
 */
export function BuiltTripScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return (
    <RequireAccount>
      <BuiltTrip tripId={tripId} />
    </RequireAccount>
  );
}
