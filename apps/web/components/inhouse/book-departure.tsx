'use client';

import { useTranslator } from '@suskii/i18n/react';
import { seatsFor, type CurrencyCode, type TravellerCounts } from '@suskii/shared/lite';
import { Button, Card, PassengerPicker } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { browserApi, problemSlug } from '../../lib/browser-api';
import { useTravellerLabels } from '../search/traveller-labels';

import type { BookDepartureMessages } from './book-departure-messages';

/** A departure with its labels formatted on the server (no Intl differences at hydration). */
export interface DepartureOption {
  id: string;
  label: string;
  seatsLeft: number;
  /** Formatted per-person prices; `null` when that traveller type cannot book. */
  prices: { adult: string; child: string | null; infant: string | null };
}

type Blocker = 'full' | 'notEnoughRoom' | 'childrenNotAllowed' | 'infantsNotAllowed';

function blocker(option: DepartureOption, travellers: TravellerCounts): Blocker | null {
  if (option.seatsLeft === 0) return 'full';
  if (option.seatsLeft < seatsFor(travellers)) return 'notEnoughRoom';
  if (travellers.children > 0 && option.prices.child === null) return 'childrenNotAllowed';
  if (travellers.infants > 0 && option.prices.infant === null) return 'infantsNotAllowed';
  return null;
}

/**
 * Choosing a package or tour date for a group, then a quote that checks seats, who may book and
 * the price against the catalog (ADR-025); checkout shows the exact total.
 */
export function BookDeparture({
  kind,
  departures,
  initialTravellers,
  currency,
}: {
  kind: 'package' | 'tour';
  departures: readonly DepartureOption[];
  initialTravellers: TravellerCounts;
  currency: CurrencyCode;
}) {
  const { t } = useTranslator<BookDepartureMessages>();
  const travellerLabels = useTravellerLabels();
  const router = useRouter();
  const [travellers, setTravellers] = useState(initialTravellers);
  const [selected, setSelected] = useState<string | null>(
    () => departures.find((option) => blocker(option, initialTravellers) === null)?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choice = departures.find((option) => option.id === selected) ?? null;
  const chosenOk = choice !== null && blocker(choice, travellers) === null;

  const submit = async () => {
    if (!choice || !chosenOk) {
      setError(t('inhouse.book.choose'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const {
        data,
        error: problem,
        response,
      } = await browserApi().POST('/v1/inhouse-quotes', {
        body: { kind, departureId: choice.id, travellers, currency },
      });
      if (data) {
        router.push(`/checkout/${data.quoteId}`);
        return;
      }
      const slug = problemSlug(problem);
      setError(
        slug === 'sold-out'
          ? t('inhouse.book.errors.soldOut')
          : response.status === 410 || response.status === 404
            ? t('inhouse.book.errors.unavailable')
            : response.status === 422
              ? t('inhouse.book.errors.travellers')
              : response.status === 429
                ? t('inhouse.book.errors.tooMany')
                : t('inhouse.book.errors.generic'),
      );
    } catch {
      setError(t('inhouse.book.errors.generic'));
    }
    setBusy(false);
  };

  return (
    <Card asChild className="flex flex-col gap-4 p-4">
      <section aria-labelledby="book-heading">
        <h2 id="book-heading" className="font-heading text-h3 font-bold text-heading">
          {t('inhouse.book.heading')}
        </h2>
        <PassengerPicker
          id="book-travellers"
          label={t('inhouse.book.travellers')}
          summary={travellerLabels.summary(travellers)}
          value={travellers}
          onChange={setTravellers}
          labels={travellerLabels.labels}
        />
        {departures.length === 0 ? (
          <p className="font-body text-body text-foreground">{t('inhouse.book.noDates')}</p>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{t('inhouse.book.heading')}</legend>
            {departures.map((option) => {
              const blocked = blocker(option, travellers);
              const id = `departure-${option.id}`;
              return (
                <label
                  key={option.id}
                  htmlFor={id}
                  className="flex items-start gap-3 rounded-md border border-border-strong p-3 has-checked:border-primary"
                >
                  <input
                    id={id}
                    type="radio"
                    name="departure"
                    value={option.id}
                    checked={selected === option.id}
                    disabled={blocked !== null}
                    onChange={() => setSelected(option.id)}
                    className="mt-1 size-5 shrink-0 accent-primary"
                  />
                  <span className="flex flex-col gap-1 font-body text-body-sm text-foreground">
                    <span className="text-body font-bold">{option.label}</span>
                    <span>
                      {t('inhouse.book.perAdult', { price: option.prices.adult })}
                      {option.prices.child
                        ? ` · ${t('inhouse.book.perChild', { price: option.prices.child })}`
                        : ''}
                      {option.prices.infant
                        ? ` · ${t('inhouse.book.perInfant', { price: option.prices.infant })}`
                        : ''}
                    </span>
                    <span className={blocked ? 'text-danger' : 'text-muted'}>
                      {blocked
                        ? t(`inhouse.book.${blocked}`)
                        : t('inhouse.book.seatsLeft', { count: option.seatsLeft })}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        {error ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button
          fullWidth
          loading={busy}
          disabled={departures.length === 0}
          onClick={() => void submit()}
        >
          {busy ? t('inhouse.book.submitting') : t('inhouse.book.submit')}
        </Button>
      </section>
    </Card>
  );
}
