import { useFormatters } from '@suskii/i18n/react';
import { BOOKING_IN_PROGRESS_STATUSES, type BookingStatus } from '@suskii/shared';
import { Badge, Button, Card, Modal, useToast, type BadgeProps } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { PlanPanel, RefundList } from '../components/booking/plan-panel';
import { Loading, Notice, OfflineBanner } from '../components/states';
import { useSensitiveScreen } from '../hooks/use-sensitive-screen';
import { isNetworkError } from '../lib/api';
import { documentStore, type SavedDocument } from '../lib/documents';
import { openHostedCheckout, startPayment } from '../lib/payment';
import { followBooking } from '../lib/push';
import { tripStore, type Booking } from '../lib/trips';
import { useApp, useT } from '../providers/app-provider';

const STATUS_VARIANT: Partial<Record<BookingStatus, NonNullable<BadgeProps['variant']>>> = {
  CONFIRMED: 'success',
  REFUND_PENDING: 'warning',
  REFUNDED: 'neutral',
  FAILED: 'danger',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
};

const STATUS_HELP = {
  REFUND_PENDING: 'refund',
  REFUNDED: 'refunded',
  HELD: 'held',
  PARTIALLY_PAID: 'partlyPaid',
  FAILED: 'failed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const satisfies Partial<Record<BookingStatus, string>>;
type HelpKey = (typeof STATUS_HELP)[keyof typeof STATUS_HELP] | 'unpaid';
const helpKey = (status: BookingStatus): HelpKey =>
  (STATUS_HELP as Partial<Record<BookingStatus, HelpKey>>)[status] ?? 'unpaid';

const ON_PLAN: readonly BookingStatus[] = ['HELD', 'PARTIALLY_PAID'];

/** Keep polling while payment, ticketing or a refund is in flight (webhooks decide). */
export const shouldPoll = (booking: Booking): boolean =>
  BOOKING_IN_PROGRESS_STATUSES.includes(booking.status) ||
  (ON_PLAN.includes(booking.status) && booking.payment?.status === 'pending') ||
  booking.status === 'REFUND_PENDING' ||
  booking.refunds.some((refund) => refund.status === 'in_progress');

type Loaded =
  | { kind: 'ready'; booking: Booking; offline: boolean; savedAt: string | null }
  | { kind: 'missing' };

function Documents({
  booking,
  headers,
}: {
  booking: Booking;
  headers: () => Promise<Record<string, string>>;
}) {
  const { t } = useT();
  const { session } = useApp();
  const { toast } = useToast();
  const [saved, setSaved] = useState<SavedDocument[]>(() => documentStore.saved(booking.id));
  const [busy, setBusy] = useState<string | null>(null);
  if (booking.documents.length === 0) return null;

  const save = async (document: Booking['documents'][number]) => {
    setBusy(document.id);
    try {
      let result: SavedDocument;
      try {
        result = await documentStore.download(booking.id, document, await headers());
      } catch (error) {
        // An expired access token: rotate once and retry.
        if (!session.signedIn || !(await session.refresh())) throw error;
        result = await documentStore.download(booking.id, document, await headers());
      }
      setSaved((current) => [result, ...current.filter((item) => item.documentId !== document.id)]);
    } catch {
      toast({ title: t('mobile.trip.downloadFailed'), variant: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('booking.documents')}
      </Text>
      {booking.documents.map((document) => {
        const copy = saved.find((item) => item.documentId === document.id);
        return (
          <View key={document.id} className="gap-2">
            <Text className="font-body-bold text-body-sm text-foreground">
              {t(`booking.download.${document.type}`)}
            </Text>
            {copy ? (
              <View className="gap-2">
                <Text testID="document-saved" className="font-body text-caption text-success">
                  {t('mobile.trip.savedOffline')}
                </Text>
                <Button
                  testID="document-open"
                  variant="secondary"
                  onPress={() =>
                    void documentStore.open(copy, t(`booking.download.${document.type}`))
                  }
                >
                  {t('mobile.trip.open')}
                </Button>
              </View>
            ) : (
              <Button
                testID="document-save"
                variant="secondary"
                loading={busy === document.id}
                onPress={() => void save(document)}
              >
                {t('mobile.trip.saveOffline')}
              </Button>
            )}
          </View>
        );
      })}
    </Card>
  );
}

/**
 * A trip (ADR-020): status (polled while work is in flight), itinerary or stay, travellers, plan,
 * refunds and documents that stay available offline. Guests reach it with the token stored at
 * checkout or from an emailed link.
 */
export function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, session } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  useSensitiveScreen();

  const headers = async (): Promise<Record<string, string>> => {
    const guest = await tripStore.bookingHeaders(id);
    const access = session.accessToken();
    return { ...guest, ...(access ? { Authorization: `Bearer ${access}` } : {}) };
  };

  const query = useQuery({
    queryKey: ['booking', id],
    refetchInterval: (state) =>
      state.state.data?.kind === 'ready' &&
      !state.state.data.offline &&
      shouldPoll(state.state.data.booking)
        ? 2500
        : false,
    queryFn: async (): Promise<Loaded> => {
      try {
        const { data, response } = await api.GET('/v1/bookings/{bookingId}', {
          params: { path: { bookingId: id }, header: await tripStore.bookingHeaders(id) },
        });
        if (data) {
          tripStore.saveBooking(data);
          return { kind: 'ready', booking: data, offline: false, savedAt: null };
        }
        if (response.status === 404 || response.status === 400) return { kind: 'missing' };
        throw new Error(String(response.status));
      } catch (error) {
        const cached = tripStore.cachedBooking(id);
        if (cached && isNetworkError(error)) {
          return { kind: 'ready', booking: cached.booking, offline: true, savedAt: cached.savedAt };
        }
        throw error;
      }
    },
  });

  if (query.isPending) return <Loading label={t('booking.loading')} />;
  if (query.data?.kind === 'missing') {
    return <Notice title={t('booking.notFound.heading')} body={t('booking.notFound.body')} />;
  }
  if (!query.data) {
    return (
      <Notice
        body={t('booking.error')}
        action={t('booking.retry')}
        onAction={() => void query.refetch()}
      />
    );
  }

  const { booking, offline, savedAt } = query.data;
  const status = booking.status;
  const plan = booking.paymentPlan;
  const guestTrip = tripStore.deviceTripIds().includes(booking.id);
  const help =
    status === 'CONFIRMED'
      ? t('booking.statusHelp.confirmed', { email: booking.contact.email })
      : BOOKING_IN_PROGRESS_STATUSES.includes(status)
        ? t('booking.statusHelp.working')
        : t(`booking.statusHelp.${helpKey(status)}`);

  const pay = async (options: { payInFull?: boolean } = {}) => {
    setBusy(true);
    setActionError(null);
    const bookingHeaders = await tripStore.bookingHeaders(booking.id);
    if (booking.pendingPriceChange) {
      const consent = await api.POST('/v1/bookings/{bookingId}/price-consent', {
        params: { path: { bookingId: booking.id }, header: bookingHeaders },
        body: { total: booking.pendingPriceChange.current },
      });
      if (!consent.data) {
        setBusy(false);
        void query.refetch();
        return;
      }
    }
    const started = await startPayment(api, booking.id, bookingHeaders, {
      payInFull: options.payInFull ?? false,
    });
    if (started.kind === 'redirect') await openHostedCheckout(started.checkoutUrl);
    else if (started.kind === 'device') setActionError(t('mobile.checkout.deviceCheckFailed'));
    else if (started.kind !== 'paid' && started.kind !== 'price-changed')
      setActionError(t('checkout.errors.generic'));
    setBusy(false);
    void query.refetch();
  };

  const cancel = async () => {
    setBusy(true);
    const { data } = await api.POST('/v1/bookings/{bookingId}/cancel', {
      params: {
        path: { bookingId: booking.id },
        header: await tripStore.bookingHeaders(booking.id),
      },
    });
    if (!data) setActionError(t('checkout.errors.generic'));
    setBusy(false);
    void query.refetch();
  };

  const follow = async () => {
    const ok = await followBooking(
      api,
      booking.id,
      await tripStore.bookingHeaders(booking.id),
      true,
    );
    toast({
      title: ok ? t('mobile.trip.notifyOn') : t('mobile.trip.notifyOff'),
      variant: ok ? 'success' : 'info',
    });
  };

  const forget = async () => {
    documentStore.remove(booking.id);
    await tripStore.forget(booking.id);
    setRemoving(false);
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: t('booking.heading', { reference: booking.reference }) }} />
      {offline ? <OfflineBanner label={t('mobile.offline')} /> : null}
      <ScrollView testID="trip" contentContainerClassName="gap-4 p-4 pb-12">
        <View accessibilityLiveRegion="polite" className="items-start gap-2">
          <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
            {t('booking.heading', { reference: booking.reference })}
          </Text>
          <View testID="trip-status">
            <Badge variant={STATUS_VARIANT[status] ?? 'info'}>
              {t(`booking.status.${status}`)}
            </Badge>
          </View>
          <Text className="font-body text-body text-foreground">{help}</Text>
          {offline && savedAt ? (
            <Text className="font-body text-caption text-muted">
              {t('mobile.trip.offlineCopy', { time: format.dateTime(savedAt) })}
            </Text>
          ) : null}
        </View>
        {actionError ? (
          <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
            {actionError}
          </Text>
        ) : null}
        {!offline ? (
          <View className="gap-2">
            {status === 'AWAITING_PAYMENT' && booking.payment?.checkoutUrl ? (
              <Button
                testID="complete-payment"
                onPress={() =>
                  void openHostedCheckout(booking.payment?.checkoutUrl ?? '').then(() =>
                    query.refetch(),
                  )
                }
              >
                {t('booking.completePayment')}
              </Button>
            ) : null}
            {status === 'PRICED' || (plan?.status === 'active' && booking.pendingPriceChange) ? (
              <Button testID="pay-now" loading={busy} onPress={() => void pay()}>
                {booking.pendingPriceChange
                  ? t('checkout.priceChange.accept')
                  : t('booking.retryPayment')}
              </Button>
            ) : null}
          </View>
        ) : null}

        {booking.flight ? (
          <Card className="gap-3 p-4">
            <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
              {t('booking.itinerary')}
            </Text>
            <Text className="font-body text-body-sm text-foreground">
              {booking.flight.owner.name} · {t(`cabins.${booking.flight.cabinClass}`)}
            </Text>
            {booking.flight.airlineReference ? (
              <Text className="font-body text-body text-foreground">
                {t('booking.airlineReference')}:{' '}
                <Text testID="airline-reference" className="font-body-bold">
                  {booking.flight.airlineReference}
                </Text>
              </Text>
            ) : null}
            {booking.flight.slices.map((slice, index) => (
              <View key={index} className="gap-1">
                <Text className="font-body-bold text-caption text-muted">
                  {format.date(slice.departureLocal.slice(0, 10), 'weekday')}
                </Text>
                <Text className="font-body text-body text-foreground">
                  {slice.departureLocal.slice(11, 16)} {slice.origin.cityName ?? slice.origin.code}{' '}
                  ({slice.origin.code}) → {slice.arrivalLocal.slice(11, 16)}
                  {slice.arrivalDayOffset > 0 ? ` +${slice.arrivalDayOffset}` : ''}{' '}
                  {slice.destination.cityName ?? slice.destination.code} ({slice.destination.code})
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        {booking.hotel ? (
          <Card className="gap-2 p-4">
            <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
              {t('booking.stay')}
            </Text>
            <Text className="font-body-bold text-body text-foreground">{booking.hotel.name}</Text>
            <Text className="font-body text-body-sm text-foreground">
              {format.dateRange(booking.hotel.checkIn, booking.hotel.checkOut, 'medium')} ·{' '}
              {t('booking.nights', { count: booking.hotel.nights })}
            </Text>
            {booking.hotel.confirmationNumber ? (
              <Text className="font-body text-body text-foreground">
                {t('booking.confirmationNumber')}: {booking.hotel.confirmationNumber}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {plan ? (
          <PlanPanel
            booking={booking}
            plan={plan}
            busy={busy || offline}
            onPay={(options) => void pay(options)}
            onCancel={cancel}
          />
        ) : null}
        <RefundList refunds={booking.refunds} />
        <Documents booking={booking} headers={headers} />

        <Card className="gap-3 p-4">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {booking.hotel ? t('booking.guests') : t('booking.travellers')}
          </Text>
          {booking.passengers.map((passenger) => (
            <View key={passenger.position} className="gap-1">
              <Text className="font-body-bold text-body text-foreground">
                {passenger.givenNames} {passenger.surname}
              </Text>
              {passenger.ticketNumber ? (
                <Text testID="ticket-number" className="font-body text-body-sm text-foreground">
                  {t('booking.ticket', { number: passenger.ticketNumber })}
                </Text>
              ) : null}
              {passenger.document ? (
                <Text className="font-body text-caption text-muted">
                  {t('booking.passport', { hint: passenger.document.hint })}
                </Text>
              ) : null}
            </View>
          ))}
        </Card>

        <Card className="gap-2 p-4">
          <Text className="font-body text-body-sm text-foreground">{t('booking.price')}</Text>
          <Text className="font-heading text-h3 text-heading">
            {format.money(plan?.total ?? booking.price.total)}
          </Text>
          {booking.paid.amountMinor > 0 ? (
            <Text testID="booking-paid" className="font-body text-body-sm text-foreground">
              {t('booking.paid')}: {format.money(booking.paid)}
            </Text>
          ) : null}
        </Card>

        {!offline ? (
          <Button variant="ghost" onPress={() => void follow()}>
            {t('mobile.trip.notify')}
          </Button>
        ) : null}
        {guestTrip ? (
          <Button variant="ghost" onPress={() => setRemoving(true)}>
            {t('mobile.trip.remove')}
          </Button>
        ) : null}
      </ScrollView>
      <Modal
        open={removing}
        onOpenChange={setRemoving}
        title={t('mobile.trip.removeTitle')}
        description={t('mobile.trip.removeBody')}
        closeLabel={t('common.close')}
        footer={
          <View className="gap-2">
            <Button fullWidth onPress={() => void forget()}>
              {t('mobile.trip.removeConfirm')}
            </Button>
            <Button variant="ghost" onPress={() => setRemoving(false)}>
              {t('mobile.trip.keep')}
            </Button>
          </View>
        }
      />
    </View>
  );
}
