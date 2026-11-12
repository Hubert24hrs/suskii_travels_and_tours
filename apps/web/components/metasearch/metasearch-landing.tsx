'use client';

import { useFormatters, useTranslator } from '@suskii/i18n/react';
import { Button, Card } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { flightRequestHref } from '../../lib/search-links';
import { AppLink } from '../app-link';

import type { MetasearchMessages } from './metasearch-messages';

type Landing = Schemas['MetasearchLanding'];
type Phase =
  | { kind: 'checking' }
  | { kind: 'ready'; landing: Landing }
  | { kind: 'invalid' }
  | { kind: 'error' };

/**
 * A metasearch deep link (ADR-081): the API quotes the partner's itinerary again. Same or lower
 * goes straight to checkout; a higher price is shown before continuing; a gone flight or a
 * lapsed link offers the same search.
 */
export function MetasearchLanding({ token }: { token: string }) {
  const { t } = useTranslator<MetasearchMessages>();
  const format = useFormatters();
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; phase: Phase } | null>(null);
  const key = `${token}:${attempt}`;
  const phase: Phase = result?.key === key ? result.phase : { kind: 'checking' };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: Phase;
      try {
        const { data, response } = await browserApi().POST('/v1/metasearch/landings', {
          body: { token },
        });
        next = data
          ? { kind: 'ready', landing: data }
          : response.status === 404
            ? { kind: 'invalid' }
            : { kind: 'error' };
      } catch {
        next = { kind: 'error' };
      }
      if (cancelled) return;
      if (
        next.kind === 'ready' &&
        next.landing.quoteId &&
        (next.landing.outcome === 'same' || next.landing.outcome === 'lower')
      ) {
        router.replace(`/checkout/${next.landing.quoteId}`);
        return;
      }
      setResult({ key, phase: next });
    })();
    return () => {
      cancelled = true;
    };
  }, [key, token, router]);

  if (phase.kind === 'checking')
    return (
      <p role="status" className="font-body text-body text-foreground">
        {t('pages.metasearch.checking')}
      </p>
    );

  if (phase.kind === 'error')
    return (
      <Card className="flex flex-col items-start gap-4 p-6" role="alert">
        <p className="font-body text-body text-foreground">{t('pages.metasearch.error')}</p>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {t('pages.metasearch.retry')}
        </Button>
      </Card>
    );

  if (phase.kind === 'invalid')
    return (
      <Card className="flex flex-col items-start gap-4 p-6">
        <h2 className="font-heading text-h3 font-bold text-heading">
          {t('pages.metasearch.expiredTitle')}
        </h2>
        <p className="font-body text-body text-foreground">{t('pages.metasearch.expiredBody')}</p>
        <AppLink href="/flights" className="font-body text-body font-bold text-primary underline">
          {t('pages.metasearch.otherFlights')}
        </AppLink>
      </Card>
    );

  const { landing } = phase;
  const search = (
    <AppLink
      href={flightRequestHref(landing.request)}
      className="font-body text-body font-bold text-primary underline"
      data-testid="metasearch-other-flights"
    >
      {t('pages.metasearch.otherFlights')}
    </AppLink>
  );

  if (landing.outcome === 'higher' && landing.quoteId && landing.current && landing.offer) {
    const quoteId = landing.quoteId;
    return (
      <Card className="flex flex-col items-start gap-4 p-6" data-testid="metasearch-higher">
        <h2 className="font-heading text-h3 font-bold text-heading">
          {t('pages.metasearch.higherTitle')}
        </h2>
        <p className="font-body text-body text-foreground" suppressHydrationWarning>
          {t('pages.metasearch.higherBody', {
            partner: landing.partner.name,
            shown: format.money(landing.shown),
            current: format.money(landing.current),
          })}
        </p>
        <ul className="flex flex-col gap-1 font-body text-body-sm text-foreground">
          {landing.offer.slices.map((slice) => (
            <li key={slice.departureUtc} suppressHydrationWarning>
              {slice.origin.code} → {slice.destination.code} ·{' '}
              {format.date(slice.departureLocal, 'weekday')} ·{' '}
              {slice.segments
                .map((segment) => `${segment.marketingCarrier.code}${segment.flightNumber}`)
                .join(', ')}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={() => router.push(`/checkout/${quoteId}`)}>
            {t('pages.metasearch.continue', { price: format.money(landing.current) })}
          </Button>
          {search}
        </div>
      </Card>
    );
  }

  const expired = landing.outcome === 'expired';
  return (
    <Card className="flex flex-col items-start gap-4 p-6" data-testid="metasearch-gone">
      <h2 className="font-heading text-h3 font-bold text-heading">
        {t(expired ? 'pages.metasearch.expiredTitle' : 'pages.metasearch.unavailableTitle')}
      </h2>
      <p className="font-body text-body text-foreground">
        {t(expired ? 'pages.metasearch.expiredBody' : 'pages.metasearch.unavailableBody')}
      </p>
      {search}
    </Card>
  );
}
