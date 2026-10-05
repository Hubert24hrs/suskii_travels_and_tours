'use client';

import type { CurrencyCode } from '@suskii/shared/lite';
import { Button } from '@suskii/ui-web';
import { BellPlus } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { useSignedIn } from '../account/use-account';
import { AppLink } from '../app-link';

import { useResultsT } from './results-messages';

type Outcome = 'watching' | 'exists' | 'limit' | 'error';

/**
 * "Watch this route" (ADR-032): a price alert for the first flight of the search, at its date,
 * cabin and currency. Visitors are sent to sign in and brought back.
 */
export function WatchRoute({
  request,
  currency,
}: {
  request: Schemas['FlightSearchRequestInput'];
  currency: CurrencyCode;
}) {
  const { t } = useResultsT();
  const signedIn = useSignedIn();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const slice = request.slices[0];
  if (!slice) return null;

  if (!signedIn) {
    const next = `${pathname}?${params.toString()}`;
    return (
      <AppLink
        href={`/sign-in?next=${encodeURIComponent(next)}`}
        className="inline-flex items-center gap-2 self-start font-body text-body-sm font-bold text-primary underline focus-visible:focus-ring"
      >
        <BellPlus aria-hidden="true" className="size-4" />
        {t('alerts.signIn')}
      </AppLink>
    );
  }

  const watch = async () => {
    setBusy(true);
    const { response, error } = await browserApi().POST('/v1/me/price-alerts', {
      body: {
        origin: slice.origin,
        destination: slice.destination,
        departureDate: slice.departureDate,
        cabinClass: request.cabinClass ?? 'economy',
        currency,
      },
    });
    setBusy(false);
    const slug = problemSlug(error);
    setOutcome(
      response.ok
        ? 'watching'
        : slug === 'price-alert-exists'
          ? 'exists'
          : slug === 'price-alert-limit'
            ? 'limit'
            : 'error',
    );
  };

  return (
    <div className="flex flex-col items-start gap-2">
      {outcome === 'watching' || outcome === 'exists' ? null : (
        <Button
          variant="ghost"
          loading={busy}
          onClick={() => void watch()}
          data-testid="watch-route"
        >
          <BellPlus aria-hidden="true" className="size-4" />
          {t('alerts.watch')}
        </Button>
      )}
      {outcome ? (
        <p
          role={outcome === 'error' || outcome === 'limit' ? 'alert' : 'status'}
          className={
            outcome === 'error' || outcome === 'limit'
              ? 'font-body text-body-sm text-danger'
              : 'font-body text-body-sm text-success'
          }
        >
          {t(`alerts.${outcome}`)}
        </p>
      ) : null}
    </div>
  );
}
