import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card, Input, Modal } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { ChoiceChips } from '../components/booking/form-controls';
import { Loading, Notice } from '../components/states';
import { appConfig } from '../config';
import { useSensitiveScreen } from '../hooks/use-sensitive-screen';
import { useApp, useT } from '../providers/app-provider';

type Ride = Schemas['Ride'];
type Status = Ride['status'];

const POLL_MS = 4_000;
const FINAL: readonly Status[] = ['completed', 'cancelled', 'no_driver'];
const CANCELLABLE: readonly Status[] = ['scheduled', 'searching', 'assigned', 'arrived'];
const SHAREABLE: readonly Status[] = ['assigned', 'arrived', 'in_progress'];
const STARS = ['1', '2', '3', '4', '5'] as const;

function LiveRide({ rideId }: { rideId: string }) {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const [dialog, setDialog] = useState<'cancel' | 'sos' | null>(null);
  const [cancelFree, setCancelFree] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stars, setStars] = useState<(typeof STARS)[number]>('5');
  const [comment, setComment] = useState('');
  const path = { params: { path: { rideId } } };

  const query = useQuery({
    queryKey: ['ride', rideId],
    refetchInterval: (state) =>
      state.state.data && FINAL.includes(state.state.data.status) ? false : POLL_MS,
    queryFn: async (): Promise<Ride | null> => {
      const { data, response } = await api.GET('/v1/rides/{rideId}', path);
      if (data) return data;
      if (response.status === 404) return null;
      throw new Error(String(response.status));
    },
  });
  const ride = query.data;
  // The cancellation terms the rider accepted live on the booking.
  const terms = useQuery({
    queryKey: ['ride-terms', ride?.bookingId],
    enabled: Boolean(ride?.bookingId),
    staleTime: Infinity,
    queryFn: async () => {
      const { data } = await api.GET('/v1/bookings/{bookingId}', {
        params: { path: { bookingId: ride?.bookingId ?? '' } },
      });
      return data?.ride?.cancellation ?? null;
    },
  });

  if (query.isPending) return <Loading label={t('mobile.loading')} />;
  if (ride === null) return <Notice body={t('cars.rides.live.error')} />;
  if (!ride)
    return (
      <Notice
        body={t('cars.rides.live.error')}
        action={t('mobile.retry')}
        onAction={() => void query.refetch()}
      />
    );

  const act = async (run: () => Promise<boolean>, success: string) => {
    setBusy(true);
    setError(null);
    try {
      if (await run()) {
        setNotice(success);
        setDialog(null);
        await query.refetch();
      } else setError(t('cars.rides.live.actionError'));
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () =>
    act(
      async () => (await api.POST('/v1/rides/{rideId}/cancel', path)).data !== undefined,
      t('cars.rides.live.cancelled'),
    );
  // The app has no location access yet (backlog): the SOS goes out with the ride's own trace.
  const sos = () =>
    act(
      async () =>
        (await api.POST('/v1/rides/{rideId}/sos', { ...path, body: { position: null } })).response
          .ok,
      t('cars.rides.live.sosSent'),
    );
  const share = () =>
    act(async () => {
      const created = await api.POST('/v1/rides/{rideId}/share', path);
      if (!created.data) return false;
      const url = `${appConfig.webBaseUrl}/trip/${created.data.token}`;
      await Share.share({ message: t('mobile.cars.shareMessage', { url }) });
      return true;
    }, t('cars.rides.live.shareLink'));
  const stopSharing = () =>
    act(
      async () => (await api.DELETE('/v1/rides/{rideId}/share', path)).response.ok,
      t('cars.rides.live.shareStop'),
    );
  const rate = () =>
    act(
      async () =>
        (
          await api.POST('/v1/rides/{rideId}/rating', {
            ...path,
            body: { stars: Number(stars), comment: comment.trim() || null },
          })
        ).response.ok,
      t('cars.rides.live.rated'),
    );

  // The documented policy: free before a driver accepts and inside the free window after.
  const openCancel = () => {
    const window = terms.data?.freeCancelSeconds ?? 0;
    setCancelFree(!ride.assignedAt || Date.now() - Date.parse(ride.assignedAt) < window * 1000);
    setDialog('cancel');
  };

  const over = FINAL.includes(ride.status);
  const statusText =
    ride.status === 'scheduled' && ride.scheduledFor
      ? t('cars.rides.live.status.scheduled', { time: format.dateTime(ride.scheduledFor) })
      : t(`cars.rides.live.status.${ride.status}`);

  return (
    <>
      <Card className="gap-3 p-4">
        <View accessibilityLiveRegion="polite" className="items-start gap-2">
          <Text testID="ride-status" className="font-heading text-h3 text-heading">
            {statusText}
          </Text>
          {!over ? (
            <Text className="font-body text-caption text-muted">
              {t('cars.rides.live.updating')}
            </Text>
          ) : null}
          {ride.etaSeconds !== null && !over ? (
            <Text className="font-body text-body text-foreground">
              {t('cars.rides.live.eta', { count: Math.max(1, Math.round(ride.etaSeconds / 60)) })}
            </Text>
          ) : null}
        </View>
        <Text className="font-body text-body-sm text-foreground">
          {t('cars.rides.live.route', { pickup: ride.pickup.label, dropoff: ride.dropoff.label })}
        </Text>
        <Text className="font-body text-body-sm text-foreground">
          {t('cars.rides.live.fare', { fare: format.money(ride.fare) })}
        </Text>
        {ride.driver ? (
          <View testID="ride-driver" className="gap-1">
            <Text className="font-body-bold text-body text-foreground">
              {ride.driver.rating === null
                ? t('cars.rides.live.driverNew', { name: ride.driver.firstName })
                : t('cars.rides.live.driver', {
                    name: ride.driver.firstName,
                    rating: format.number(ride.driver.rating),
                  })}
            </Text>
            <Text className="font-body text-body-sm text-foreground">
              {t('cars.rides.live.vehicle', ride.driver.vehicle)}
            </Text>
          </View>
        ) : null}
        {ride.pin ? (
          <View className="gap-1 rounded-md bg-primary-subtle p-3">
            <Text testID="ride-pin" className="font-heading text-h4 text-heading">
              {t('cars.rides.live.pin', { pin: ride.pin })}
            </Text>
            <Text className="font-body text-caption text-foreground">
              {t('cars.rides.live.pinHint')}
            </Text>
          </View>
        ) : null}
        {ride.cancellationFee && ride.cancellationFee.amountMinor > 0 ? (
          <Badge variant="warning">{format.money(ride.cancellationFee)}</Badge>
        ) : null}
      </Card>

      {notice ? (
        <Text
          testID="ride-notice"
          accessibilityRole="alert"
          className="font-body text-body text-success"
        >
          {notice}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}

      {!over ? (
        <View className="gap-3">
          {ride.status === 'in_progress' ||
          ride.status === 'arrived' ||
          ride.status === 'assigned' ? (
            <Button testID="ride-sos" variant="danger" fullWidth onPress={() => setDialog('sos')}>
              {t('cars.rides.live.sos')}
            </Button>
          ) : null}
          {SHAREABLE.includes(ride.status) ? (
            ride.sharing ? (
              <Button
                testID="ride-share-stop"
                variant="ghost"
                loading={busy}
                onPress={() => void stopSharing()}
              >
                {t('cars.rides.live.shareStop')}
              </Button>
            ) : (
              <Button
                testID="ride-share"
                variant="secondary"
                loading={busy}
                onPress={() => void share()}
              >
                {t('cars.rides.live.share')}
              </Button>
            )
          ) : null}
          {SHAREABLE.includes(ride.status) ? (
            <Text className="font-body text-caption text-muted">
              {t('cars.rides.live.shareHint')}
            </Text>
          ) : null}
          {CANCELLABLE.includes(ride.status) ? (
            <Button testID="ride-cancel" variant="ghost" onPress={openCancel}>
              {t('cars.rides.live.cancel')}
            </Button>
          ) : null}
        </View>
      ) : null}

      {ride.status === 'completed' && !ride.rated ? (
        <Card testID="ride-rating" className="gap-3 p-4">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('cars.rides.live.rate')}
          </Text>
          <ChoiceChips
            testID="ride-stars"
            label={t('cars.rides.live.rate')}
            options={STARS.map((value) => ({
              value,
              label: t('cars.rides.live.rateStars', { count: Number(value) }),
            }))}
            value={stars}
            onChange={setStars}
          />
          <Input
            testID="ride-comment"
            label={t('cars.rides.live.rateComment')}
            value={comment}
            onChangeText={setComment}
            maxLength={500}
            multiline
          />
          <Button testID="ride-rate" loading={busy} onPress={() => void rate()}>
            {t('cars.rides.live.rateSubmit')}
          </Button>
        </Card>
      ) : null}

      <Modal
        open={dialog === 'cancel'}
        onOpenChange={(open) => setDialog(open ? 'cancel' : null)}
        title={t('cars.rides.live.cancelTitle')}
        description={
          cancelFree
            ? t('cars.rides.live.cancelFree')
            : t('cars.rides.live.cancelFee', {
                fee: terms.data ? format.money(terms.data.fee) : '',
              })
        }
        closeLabel={t('common.close')}
        footer={
          <View className="gap-2">
            <Button
              testID="ride-cancel-confirm"
              fullWidth
              loading={busy}
              onPress={() => void cancel()}
            >
              {t('cars.rides.live.cancelConfirm')}
            </Button>
            <Button variant="ghost" onPress={() => setDialog(null)}>
              {t('cars.rides.live.cancelKeep')}
            </Button>
          </View>
        }
      />
      <Modal
        open={dialog === 'sos'}
        onOpenChange={(open) => setDialog(open ? 'sos' : null)}
        title={t('cars.rides.live.sosTitle')}
        description={t('cars.rides.live.sosBody')}
        closeLabel={t('common.close')}
        footer={
          <View className="gap-2">
            <Button
              testID="ride-sos-confirm"
              variant="danger"
              fullWidth
              loading={busy}
              onPress={() => void sos()}
            >
              {t('cars.rides.live.sosConfirm')}
            </Button>
            <Button variant="ghost" onPress={() => setDialog(null)}>
              {t('common.close')}
            </Button>
          </View>
        }
      />
    </>
  );
}

/**
 * A ride in progress (ADR-051, ADR-052): status, driver and vehicle, the PIN to give the driver,
 * sharing, SOS, cancellation under the accepted terms and a rating afterwards. The screen polls the
 * API (the REST fallback of the live channel); screenshots are blocked while the PIN shows.
 */
export function LiveRideScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const { t } = useT();
  useSensitiveScreen();
  return (
    <ScrollView
      testID="live-ride"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t('cars.rides.live.title') }} />
      <RequireAccount>
        <LiveRide rideId={rideId} />
      </RequireAccount>
    </ScrollView>
  );
}
