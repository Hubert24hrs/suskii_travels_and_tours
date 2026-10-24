'use client';

import type { CurrencyCode } from '@suskii/shared/lite';
import { Button, cn } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';

import { useCarsT } from './use-cars-t';

type SeatRow = Schemas['BusTripDetail']['seatMap']['rows'][number];
const MAX_SEATS = 6;

/**
 * The coach's seat map (ADR-051): pick up to six free seats, hold them for 10 minutes (Redis
 * grants each seat once), then a quote for the hold and checkout. A seat someone else took in
 * the meantime answers 409 `seat-taken`, and the map reloads.
 */
export function SeatPicker({
  tripId,
  rows,
  currency,
  perSeatLabel,
  open,
}: {
  tripId: string;
  rows: readonly SeatRow[];
  currency: CurrencyCode;
  /** "₦8,500 per seat", formatted on the server (no Intl differences at hydration). */
  perSeatLabel: string;
  open: boolean;
}) {
  const { t } = useCarsT();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (seat: string) => {
    setError(null);
    setSelected((current) =>
      current.includes(seat)
        ? current.filter((value) => value !== seat)
        : current.length >= MAX_SEATS
          ? current
          : [...current, seat],
    );
  };

  const submit = async () => {
    if (selected.length === 0) {
      setError(t('cars.buses.trip.errors.choose'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const held = await browserApi().POST('/v1/buses/trips/{tripId}/holds', {
        params: { path: { tripId } },
        body: { seats: selected },
      });
      if (!held.data) {
        const slug = problemSlug(held.error);
        setError(
          slug === 'seat-taken'
            ? t('cars.buses.trip.errors.taken')
            : slug === 'trip-closed'
              ? t('cars.buses.trip.errors.closed')
              : held.response.status === 429 || slug === 'hold-limit'
                ? t('cars.buses.trip.errors.tooMany')
                : t('cars.buses.trip.errors.generic'),
        );
        if (slug === 'seat-taken') {
          setSelected([]);
          router.refresh();
        }
        return;
      }
      const quote = await browserApi().POST('/v1/inhouse-quotes', {
        body: {
          kind: 'bus',
          holdId: held.data.holdId,
          holdToken: held.data.holdToken,
          currency,
        },
      });
      if (quote.data) {
        router.push(`/checkout/${quote.data.quoteId}`);
        return;
      }
      setError(t('cars.buses.trip.errors.generic'));
    } catch {
      setError(t('cars.buses.trip.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const legend = ['available', 'selected', 'held', 'sold', 'blocked'] as const;

  return (
    <section aria-labelledby="seat-map-heading" className="flex flex-col gap-4">
      <h2 id="seat-map-heading" className="font-heading text-h3 font-bold text-heading">
        {t('cars.buses.trip.seatMap')}
      </h2>
      <ul className="flex flex-wrap gap-4 font-body text-caption text-foreground">
        {legend.map((state) => (
          <li key={state} className="flex items-center gap-2">
            <span aria-hidden="true" className={cn('size-4 rounded-sm border', seatClass(state))} />
            {t(`cars.buses.trip.legend.${state}`)}
          </li>
        ))}
      </ul>
      <div className="self-start rounded-lg border border-border bg-surface p-4">
        <p className="pb-3 text-center font-body text-caption text-muted">
          {t('cars.buses.trip.front')}
        </p>
        <div role="group" aria-label={t('cars.buses.trip.seatMap')} className="flex flex-col gap-2">
          {rows.map((row, rowIndex) => (
            <div key={rowIndex} className="flex gap-2">
              {row.map((seat, index) =>
                seat ? (
                  <button
                    key={seat.seatNumber}
                    type="button"
                    data-testid={`seat-${seat.seatNumber}`}
                    disabled={!open || seat.state !== 'available'}
                    aria-pressed={selected.includes(seat.seatNumber)}
                    aria-label={`${t('cars.buses.trip.seat', { seat: seat.seatNumber })}, ${t(
                      `cars.buses.trip.legend.${selected.includes(seat.seatNumber) ? 'selected' : seat.state}`,
                    )}`}
                    onClick={() => toggle(seat.seatNumber)}
                    className={cn(
                      'flex size-12 items-center justify-center rounded-md border font-body text-caption font-bold focus-visible:focus-ring disabled:cursor-not-allowed',
                      seatClass(selected.includes(seat.seatNumber) ? 'selected' : seat.state),
                    )}
                  >
                    {seat.seatNumber}
                  </button>
                ) : (
                  <span key={`aisle-${index}`} aria-hidden="true" className="size-12" />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <p role="status" className="font-body text-body text-foreground">
        {t('cars.buses.trip.selected', { count: selected.length })}
        {selected.length > 0 ? ` (${selected.join(', ')}) · ${perSeatLabel}` : ''}
      </p>
      <p className="font-body text-caption text-muted">
        {t('cars.buses.trip.maxSeats', { count: MAX_SEATS })} {t('cars.buses.trip.holdNote')}
      </p>
      {error ? (
        <p role="alert" className="font-body text-body-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button
        className="self-start"
        loading={busy}
        disabled={!open}
        onClick={() => void submit()}
        data-testid="hold-seats"
      >
        {busy ? t('cars.buses.trip.holding') : t('cars.buses.trip.hold')}
      </Button>
    </section>
  );
}

function seatClass(state: 'available' | 'selected' | 'held' | 'sold' | 'blocked'): string {
  switch (state) {
    case 'available':
      return 'border-border-strong bg-surface text-foreground hover:border-primary';
    case 'selected':
      return 'border-primary bg-primary text-on-primary';
    case 'held':
      return 'border-dashed border-border-strong bg-background text-muted';
    case 'sold':
      return 'border-border bg-skeleton text-muted';
    case 'blocked':
      return 'border-border bg-background text-muted line-through';
  }
}
