'use client';

import { useFormatters, useTranslator } from '@suskii/i18n/react';
import type { CurrencyCode, TravellerCounts } from '@suskii/shared/lite';
import { Badge, Button, Card } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { bookingHeaders } from '../../lib/booking-token';
import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { ResultsLoading } from '../results/result-states';
import { readStored, STORAGE_KEYS } from '../search/storage';

import type { AddonOffersMessages } from './addon-offers-messages';

type Addon = Schemas['AddonCard'];
type Link = Schemas['AddonLink'];

/** What the add-ons are for: a standalone trip, an existing booking, or just browsing. */
export type AddonMode =
  | {
      kind: 'standalone';
      addons: Addon[];
      request: {
        startDate: string;
        endDate: string;
        travellers: TravellerCounts;
        cityId: string;
      };
    }
  | { kind: 'browse'; addons: Addon[] }
  | { kind: 'booking'; bookingId: string }
  | { kind: 'reference'; reference: string };

type Linked =
  | { state: 'linking' }
  | { state: 'ready'; link: Link; addons: Addon[] }
  | { state: 'failed'; message: string };

const QUOTE_ISSUES = ['not_available_there', 'dates_invalid', 'too_many_travellers'] as const;
type QuoteIssue = (typeof QUOTE_ISSUES)[number];
const asIssue = (code: unknown): QuoteIssue | null =>
  (QUOTE_ISSUES as readonly unknown[]).includes(code) ? (code as QuoteIssue) : null;

function AddonCardView({
  addon,
  busy,
  onAdd,
}: {
  addon: Addon;
  busy: boolean;
  onAdd: (() => void) | null;
}) {
  const { t } = useTranslator<AddonOffersMessages>();
  const format = useFormatters();
  return (
    <Card className="flex h-full flex-col gap-2 p-4" data-testid="addon-card">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-body text-caption font-bold text-muted">
          {t(`booking.inhouse.types.${addon.type}`)}
        </p>
        {addon.sample ? <Badge variant="neutral">{t('inhouse.sample')}</Badge> : null}
      </div>
      <h3 className="font-heading text-h4 font-bold text-heading">{addon.title}</h3>
      <p className="font-body text-body-sm text-foreground">{addon.summary}</p>
      {addon.description ? (
        <p className="font-body text-body-sm text-foreground">{addon.description}</p>
      ) : null}
      {/* Country names and prices come from Intl, which can differ between Node and browsers. */}
      <p className="font-body text-caption text-muted" suppressHydrationWarning>
        {addon.countryCodes.length === 0
          ? t('addons.anywhere')
          : t('addons.countries', {
              countries: format.list(addon.countryCodes.map((code) => format.country(code))),
            })}
      </p>
      <p className="mt-auto font-body text-body font-bold text-heading" suppressHydrationWarning>
        {t(`addons.unitPrice.${addon.pricingBasis}`, { price: format.money(addon.unitPrice) })}
      </p>
      {onAdd ? (
        <Button variant="secondary" loading={busy} onClick={onAdd}>
          {t('addons.add', { title: addon.title })}
        </Button>
      ) : null}
    </Card>
  );
}

/**
 * Add-ons on their own or for an existing trip (ADR-027). A trip is found by the booking page
 * (session or guest token) or by reference and last name; the API answers with a short-lived link
 * token and the trip's dates and travellers, which the quote then uses.
 */
export function AddonOffers({ mode, currency }: { mode: AddonMode; currency: CurrencyCode }) {
  const { t } = useTranslator<AddonOffersMessages>();
  const format = useFormatters();
  const router = useRouter();
  const [linked, setLinked] = useState<Linked>({ state: 'linking' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode.kind !== 'booking' && mode.kind !== 'reference') return;
    let cancelled = false;
    const link = async (): Promise<Linked> => {
      let body: { bookingId: string } | { reference: string; lastName: string };
      let headers: Record<string, string> = {};
      if (mode.kind === 'booking') {
        body = { bookingId: mode.bookingId };
        headers = bookingHeaders(mode.bookingId);
      } else {
        // The last name was typed in the form on the previous page and never put in the URL.
        const lastName = readStored<string>(STORAGE_KEYS.addonsLastName, 'session');
        if (!lastName) return { state: 'failed', message: t('addons.lastNameNeeded') };
        body = { reference: mode.reference, lastName };
      }
      const { data, response } = await browserApi().POST('/v1/addon-links', { body, headers });
      if (!data)
        return {
          state: 'failed',
          message:
            response.status === 409
              ? t('addons.notLinkable')
              : response.status === 404
                ? t('addons.notFound')
                : response.status === 429
                  ? t('addons.errors.tooMany')
                  : t('addons.errors.generic'),
        };
      const list = await browserApi().GET('/v1/addons', {
        params: {
          query: {
            currency,
            ...(data.trip.countryCode ? { countryCode: data.trip.countryCode } : {}),
          },
        },
      });
      return { state: 'ready', link: data, addons: list.data?.addons ?? [] };
    };
    link()
      .then((result) => {
        if (!cancelled) setLinked(result);
      })
      .catch(() => {
        if (!cancelled) setLinked({ state: 'failed', message: t('addons.errors.generic') });
      });
    return () => {
      cancelled = true;
    };
  }, [mode, currency, t]);

  const quote = async (
    addon: Addon,
    trip: { startDate: string; endDate: string; travellers: TravellerCounts },
    target: { linkToken: string } | { cityId: string },
  ) => {
    setBusy(addon.id);
    setError(null);
    try {
      const {
        data,
        error: problem,
        response,
      } = await browserApi().POST('/v1/inhouse-quotes', {
        body: {
          kind: 'addon',
          addonId: addon.id,
          startDate: trip.startDate,
          endDate: trip.endDate,
          travellers: trip.travellers,
          linkToken: 'linkToken' in target ? target.linkToken : null,
          cityId: 'cityId' in target ? target.cityId : null,
          currency,
        },
      });
      if (data) {
        router.push(`/checkout/${data.quoteId}`);
        return;
      }
      const issue = asIssue((problem as { code?: unknown } | undefined)?.code);
      setError(
        issue
          ? t(`addons.errors.${issue}`)
          : problemSlug(problem) === 'link-invalid'
            ? t('addons.linkExpired')
            : response.status === 404 || response.status === 410
              ? t('addons.errors.unavailable')
              : response.status === 429
                ? t('addons.errors.tooMany')
                : t('addons.errors.generic'),
      );
    } catch {
      setError(t('addons.errors.generic'));
    }
    setBusy(null);
  };

  const grid = (addons: readonly Addon[], onAdd: ((addon: Addon) => () => void) | null) =>
    addons.length === 0 ? (
      <p className="font-body text-body text-foreground">{t('addons.none')}</p>
    ) : (
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {addons.map((addon) => (
          <li key={addon.id}>
            <AddonCardView addon={addon} busy={busy === addon.id} onAdd={onAdd?.(addon) ?? null} />
          </li>
        ))}
      </ul>
    );

  const alert = error ? (
    <p role="alert" className="font-body text-body-sm text-danger">
      {error}
    </p>
  ) : null;

  if (mode.kind === 'browse')
    return (
      <div className="flex flex-col gap-4">
        <p className="font-body text-body text-foreground">{t('addons.browseHint')}</p>
        {grid(mode.addons, null)}
      </div>
    );

  if (mode.kind === 'standalone')
    return (
      <div className="flex flex-col gap-4">
        {alert}
        {grid(mode.addons, (addon) => () => {
          void quote(addon, mode.request, { cityId: mode.request.cityId });
        })}
      </div>
    );

  if (linked.state === 'linking') return <ResultsLoading label={t('addons.linking')} />;
  if (linked.state === 'failed')
    return (
      <p role="alert" className="font-body text-body text-foreground">
        {linked.message}
      </p>
    );
  const { link, addons } = linked;
  const travellers =
    link.trip.travellers.adults + link.trip.travellers.children + link.trip.travellers.infants;
  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-body font-bold text-foreground" data-testid="addon-trip">
        {t('addons.forBooking', {
          reference: link.trip.reference,
          dates: format.dateRange(link.trip.startDate, link.trip.endDate, 'medium'),
          travellers: t('booking.inhouse.travellers', { count: travellers }),
        })}
      </p>
      {alert}
      {grid(addons, (addon) => () => {
        void quote(addon, link.trip, { linkToken: link.linkToken });
      })}
    </div>
  );
}
