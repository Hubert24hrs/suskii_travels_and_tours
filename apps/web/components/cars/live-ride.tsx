'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Button, Card, Dialog, DialogContent, Input } from '@suskii/ui-web';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { useHydrated } from '../../lib/use-hydrated';
import { AppLink } from '../app-link';

import { useCarsT } from './use-cars-t';

type Ride = Schemas['Ride'];
type Terms = NonNullable<Schemas['Booking']['ride']>['cancellation'];
const POLL_MS = 5_000;
const FINAL: readonly Ride['status'][] = ['completed', 'cancelled', 'no_driver'];
const CANCELLABLE: readonly Ride['status'][] = ['scheduled', 'searching', 'assigned', 'arrived'];

/**
 * The rider's live view (ADR-052): status, driver and vehicle, the trip PIN, the ETA, and the
 * safety tools (share link, SOS). It polls the REST view every 5 s, the documented fallback for
 * the socket, and stops once the ride is over. Cancellation previews the published fare rule.
 */
export function LiveRide({ rideId }: { rideId: string }) {
  const { t } = useCarsT();
  const format = useFormatters();
  const hydrated = useHydrated();
  const [ride, setRide] = useState<Ride | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState<'cancel' | 'sos' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [cancelFree, setCancelFree] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/rides/{rideId}', { params: { path: { rideId } } })
      .then(async ({ data }) => {
        if (cancelled) return;
        if (!data) {
          setFailed(true);
          return;
        }
        setRide(data);
        setFailed(false);
        if (!terms) {
          const booking = await browserApi().GET('/v1/bookings/{bookingId}', {
            params: { path: { bookingId: data.bookingId } },
          });
          if (!cancelled && booking.data?.ride) setTerms(booking.data.ride.cancellation);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // `terms` is read once; polling is driven by `tick`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId, tick]);

  const over = ride ? FINAL.includes(ride.status) : false;
  useEffect(() => {
    if (over) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), POLL_MS);
    return () => window.clearInterval(timer);
  }, [over]);

  if (failed && !ride)
    return (
      <Card role="alert" className="flex flex-col items-start gap-3 p-6">
        <p className="font-body text-body text-foreground">{t('cars.rides.live.error')}</p>
        <Button variant="secondary" onClick={() => setTick((value) => value + 1)}>
          {t('cars.rides.live.title')}
        </Button>
      </Card>
    );
  if (!ride) return <p className="font-body text-body text-muted">{t('common.loading')}</p>;

  const act = async (run: () => Promise<boolean>, success: string) => {
    setBusy(true);
    setError(null);
    try {
      if (await run()) {
        setNotice(success);
        setDialog(null);
        setTick((value) => value + 1);
      } else setError(t('cars.rides.live.actionError'));
    } catch {
      setError(t('cars.rides.live.actionError'));
    } finally {
      setBusy(false);
    }
  };
  const path = { params: { path: { rideId } } };

  const cancel = () =>
    act(
      async () => (await browserApi().POST('/v1/rides/{rideId}/cancel', path)).data !== undefined,
      t('cars.rides.live.cancelled'),
    );

  const sos = () =>
    act(async () => {
      // A position helps the safety team; the SOS goes out without one if it is refused.
      const position = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
        if (!('geolocation' in navigator)) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (fix) => resolve({ lat: fix.coords.latitude, lng: fix.coords.longitude }),
          () => resolve(null),
          { timeout: 5_000, maximumAge: 30_000 },
        );
      });
      const sent = await browserApi().POST('/v1/rides/{rideId}/sos', {
        ...path,
        body: { position },
      });
      return sent.data !== undefined;
    }, t('cars.rides.live.sosSent'));

  const share = () =>
    act(async () => {
      const created = await browserApi().POST('/v1/rides/{rideId}/share', path);
      if (!created.data) return false;
      setShareUrl(`${window.location.origin}/trip/${created.data.token}`);
      return true;
    }, t('cars.rides.live.shareLink'));

  const stopSharing = () =>
    act(async () => {
      const { response } = await browserApi().DELETE('/v1/rides/{rideId}/share', path);
      if (!response.ok) return false;
      setShareUrl(null);
      return true;
    }, t('cars.rides.live.shareStop'));

  const rate = () =>
    act(async () => {
      const { response } = await browserApi().POST('/v1/rides/{rideId}/rating', {
        ...path,
        body: { stars, comment: comment.trim() || null },
      });
      return response.ok;
    }, t('cars.rides.live.rated'));

  // The documented policy: free before a driver accepts and inside the free window after.
  const openCancel = () => {
    setCancelFree(
      !ride.assignedAt ||
        (terms !== null &&
          Date.now() - Date.parse(ride.assignedAt) < terms.freeCancelSeconds * 1000),
    );
    setDialog('cancel');
  };
  const statusText =
    ride.status === 'scheduled' && ride.scheduledFor
      ? t('cars.rides.live.status.scheduled', {
          time: hydrated ? format.dateTime(ride.scheduledFor) : '',
        })
      : t(`cars.rides.live.status.${ride.status}`);

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card className="flex flex-col gap-3 p-4">
          <p
            role="status"
            className="font-heading text-h3 font-bold text-heading"
            data-testid="ride-status"
          >
            {statusText}
          </p>
          {ride.etaSeconds !== null && !over ? (
            <p className="font-body text-body text-foreground">
              {t('cars.rides.live.eta', { count: Math.max(1, Math.round(ride.etaSeconds / 60)) })}
            </p>
          ) : null}
          {ride.driver ? (
            <>
              <p className="font-body text-body font-bold text-foreground">
                {ride.driver.rating === null
                  ? t('cars.rides.live.driverNew', { name: ride.driver.firstName })
                  : t('cars.rides.live.driver', {
                      name: ride.driver.firstName,
                      rating: ride.driver.rating.toFixed(1),
                    })}
              </p>
              <p className="font-body text-body text-foreground">
                {t('cars.rides.live.vehicle', ride.driver.vehicle)}
              </p>
            </>
          ) : null}
          {ride.pin ? (
            <div className="flex flex-col gap-1 rounded-md bg-primary-subtle p-3">
              <p className="font-heading text-h4 font-bold text-heading" data-testid="ride-pin">
                {t('cars.rides.live.pin', { pin: ride.pin })}
              </p>
              <p className="font-body text-caption text-foreground">
                {t('cars.rides.live.pinHint')}
              </p>
            </div>
          ) : null}
          {!over ? (
            <p className="font-body text-caption text-muted">{t('cars.rides.live.updating')}</p>
          ) : null}
        </Card>

        {notice ? (
          <p role="status" className="font-body text-body-sm text-foreground">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {error}
          </p>
        ) : null}

        {!over ? (
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" onClick={() => setDialog('sos')} data-testid="ride-sos">
              {t('cars.rides.live.sos')}
            </Button>
            {shareUrl ? (
              <Button variant="secondary" loading={busy} onClick={() => void stopSharing()}>
                {t('cars.rides.live.shareStop')}
              </Button>
            ) : (
              <Button variant="secondary" loading={busy} onClick={() => void share()}>
                {t('cars.rides.live.share')}
              </Button>
            )}
            {CANCELLABLE.includes(ride.status) ? (
              <Button variant="ghost" onClick={openCancel}>
                {t('cars.rides.live.cancel')}
              </Button>
            ) : null}
          </div>
        ) : null}

        {shareUrl ? (
          <Card className="flex flex-col gap-2 p-4">
            <p className="font-body text-body-sm text-foreground">
              {t('cars.rides.live.shareHint')}
            </p>
            <Input
              id="share-url"
              label={t('cars.rides.live.shareLink')}
              value={shareUrl}
              readOnly
            />
            <Button
              variant="secondary"
              className="self-start"
              onClick={() =>
                void navigator.clipboard
                  .writeText(shareUrl)
                  .then(() => setNotice(t('cars.rides.live.shareCopied')))
              }
            >
              {t('cars.rides.live.shareCopy')}
            </Button>
          </Card>
        ) : null}

        {ride.status === 'completed' && !ride.rated ? (
          <Card asChild className="flex flex-col gap-3 p-4">
            <form
              method="post"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void rate();
              }}
            >
              <fieldset className="flex flex-wrap gap-2">
                <legend className="pb-2 font-heading text-h4 font-bold text-heading">
                  {t('cars.rides.live.rate')}
                </legend>
                {[1, 2, 3, 4, 5].map((value) => (
                  <label
                    key={value}
                    className="flex min-h-12 items-center gap-2 font-body text-body-sm text-foreground"
                  >
                    <input
                      type="radio"
                      name="stars"
                      value={value}
                      checked={stars === value}
                      onChange={() => setStars(value)}
                      className="size-5 accent-primary"
                    />
                    {t('cars.rides.live.rateStars', { count: value })}
                  </label>
                ))}
              </fieldset>
              <Input
                id="rate-comment"
                label={t('cars.rides.live.rateComment')}
                maxLength={500}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              <Button type="submit" className="self-start" loading={busy}>
                {t('cars.rides.live.rateSubmit')}
              </Button>
            </form>
          </Card>
        ) : null}
      </div>

      <Card asChild className="flex flex-col gap-2 p-4">
        <aside aria-label={t('cars.rides.live.title')}>
          <p className="font-body text-body text-foreground">
            {t('cars.rides.live.route', { pickup: ride.pickup.label, dropoff: ride.dropoff.label })}
          </p>
          <p className="font-body text-body-sm text-foreground">
            {t(`cars.rides.categories.${ride.category}`)}
          </p>
          <p className="font-body text-body font-bold text-heading">
            {t('cars.rides.live.fare', { fare: format.money(ride.fare) })}
          </p>
          <AppLink
            href={`/bookings/${ride.bookingId}`}
            className="inline-flex min-h-12 items-center font-body text-body-sm text-primary hover:underline focus-visible:focus-ring"
          >
            {t('cars.rides.live.title')}
          </AppLink>
        </aside>
      </Card>

      <Dialog open={dialog !== null} onOpenChange={(open) => (open ? undefined : setDialog(null))}>
        {dialog === 'cancel' ? (
          <DialogContent
            title={t('cars.rides.live.cancelTitle')}
            description={
              cancelFree || !terms
                ? t('cars.rides.live.cancelFree')
                : t('cars.rides.live.cancelFee', { fee: format.money(terms.fee) })
            }
            closeLabel={t('common.close')}
          >
            <div className="flex flex-col gap-2 md:flex-row md:justify-end">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                {t('cars.rides.live.cancelKeep')}
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void cancel()}>
                {t('cars.rides.live.cancelConfirm')}
              </Button>
            </div>
          </DialogContent>
        ) : dialog === 'sos' ? (
          <DialogContent
            title={t('cars.rides.live.sosTitle')}
            description={t('cars.rides.live.sosBody')}
            closeLabel={t('common.close')}
          >
            <div className="flex flex-col gap-2 md:flex-row md:justify-end">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                {t('cars.rides.live.cancelKeep')}
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void sos()}>
                {t('cars.rides.live.sosConfirm')}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
