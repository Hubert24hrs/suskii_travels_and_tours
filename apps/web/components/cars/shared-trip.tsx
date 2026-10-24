'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Card } from '@suskii/ui-web';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { useHydrated } from '../../lib/use-hydrated';

import { useCarsT } from './use-cars-t';

type SharedRide = Schemas['SharedRide'];
const POLL_MS = 10_000;

/**
 * A live-trip link someone shared (ADR-050): driver first name, vehicle, a rounded position and
 * the status, nothing about the rider. Polls until the link expires.
 */
export function SharedTrip({ token }: { token: string }) {
  const { t } = useCarsT();
  const format = useFormatters();
  const hydrated = useHydrated();
  const [ride, setRide] = useState<SharedRide | null>(null);
  const [gone, setGone] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/public/trips/{token}', { params: { path: { token } } })
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setRide(data);
        else setGone(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, tick]);

  useEffect(() => {
    if (gone) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), POLL_MS);
    return () => window.clearInterval(timer);
  }, [gone]);

  if (gone)
    return (
      <p role="status" className="font-body text-body text-foreground">
        {t('cars.rides.shared.expired')}
      </p>
    );
  if (!ride) return <p className="font-body text-body text-muted">{t('common.loading')}</p>;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="font-heading text-h3 font-bold text-heading">
        {t('cars.rides.shared.heading', { city: ride.cityName })}
      </h2>
      <p role="status" className="font-body text-body font-bold text-foreground">
        {ride.status === 'scheduled'
          ? t('cars.rides.live.status.searching')
          : t(`cars.rides.live.status.${ride.status}`)}
      </p>
      <p className="font-body text-body text-foreground">
        {t('cars.rides.live.route', { pickup: ride.pickupLabel, dropoff: ride.dropoffLabel })}
      </p>
      {ride.driver ? (
        <p className="font-body text-body text-foreground">
          {ride.driver.firstName} · {t('cars.rides.live.vehicle', ride.driver.vehicle)}
        </p>
      ) : null}
      {ride.etaSeconds !== null ? (
        <p className="font-body text-body-sm text-foreground">
          {t('cars.rides.live.eta', { count: Math.max(1, Math.round(ride.etaSeconds / 60)) })}
        </p>
      ) : null}
      {ride.driverPosition && hydrated ? (
        <p className="font-body text-caption text-muted">
          {t('cars.rides.shared.position', { time: format.relativeTime(ride.driverPosition.at) })}
        </p>
      ) : null}
    </Card>
  );
}
