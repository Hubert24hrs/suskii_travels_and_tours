'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card, Input } from '@suskii/ui-web';
import { useEffect, useState, type FormEvent } from 'react';

import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { randomUuid } from '../../lib/random-uuid';
import { hasSession } from '../../lib/session';
import { useHydrated } from '../../lib/use-hydrated';
import { AppLink } from '../app-link';
import { NativeSelect } from '../search/native-select';

import { useQuotesT } from './use-quotes-t';

export type AssistedQuote = Schemas['AssistedQuote'];

const PRODUCTS = ['flight', 'hotel', 'car', 'transfer', 'tour', 'package', 'other'] as const;
type Product = (typeof PRODUCTS)[number];

export const STATUS_VARIANT = {
  requested: 'info',
  offered: 'success',
  booked: 'success',
  unavailable: 'neutral',
  expired: 'neutral',
  withdrawn: 'neutral',
} as const;

const LINK =
  'inline-flex min-h-6 items-center font-body text-body-sm font-bold text-primary underline focus-visible:focus-ring';

/**
 * Asks for a price to be confirmed (ADR-104): what is wanted in a few words, where, when and
 * for how many. No names and no contact details: the API refuses text that looks like one.
 */
function AskForm({ currency, onAsked }: { currency: string; onAsked: () => void }) {
  const { t } = useQuotesT();
  const [product, setProduct] = useState<Product>('hotel');
  const [what, setWhat] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [adults, setAdults] = useState('2');
  const [children, setChildren] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const { data, error: problem } = await browserApi().POST('/v1/quotes/assisted', {
        params: { header: { 'Idempotency-Key': randomUuid() } },
        body: {
          product,
          title: what.trim(),
          request: {
            origin: origin.trim() || null,
            destination: destination.trim(),
            startDate,
            endDate: endDate || null,
            adults: Number(adults),
            children: Number(children),
          },
          currency: currency as never,
          observationId: null,
        },
      });
      if (!data) {
        const slug = problemSlug(problem);
        setError(
          slug === 'assisted-quote-limit'
            ? t('quotes.errors.limit')
            : slug === 'validation-failed'
              ? t('quotes.errors.contact')
              : t('quotes.errors.generic'),
        );
        return;
      }
      setWhat('');
      setSent(true);
      onAsked();
    } catch {
      setError(t('quotes.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-6" data-testid="quote-ask">
      <h2 className="font-heading text-h3 font-bold text-heading">{t('quotes.ask.heading')}</h2>
      <form method="post" className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <NativeSelect
          label={t('quotes.ask.product')}
          name="product"
          value={product}
          onChange={(event) => setProduct(event.target.value as Product)}
          options={PRODUCTS.map((value) => ({
            value,
            label: t(`quotes.ask.products.${value === 'other' ? 'another' : value}`),
          }))}
        />
        <Input
          label={t('quotes.ask.what')}
          hint={t('quotes.ask.whatHint')}
          name="title"
          value={what}
          required
          minLength={2}
          maxLength={160}
          onChange={(event) => setWhat(event.target.value)}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label={t('quotes.ask.origin')}
            name="origin"
            value={origin}
            maxLength={80}
            onChange={(event) => setOrigin(event.target.value)}
          />
          <Input
            label={t('quotes.ask.destination')}
            name="destination"
            value={destination}
            required
            minLength={2}
            maxLength={80}
            onChange={(event) => setDestination(event.target.value)}
          />
          <Input
            label={t('quotes.ask.startDate')}
            name="startDate"
            type="date"
            value={startDate}
            required
            onChange={(event) => setStartDate(event.target.value)}
          />
          <Input
            label={t('quotes.ask.endDate')}
            name="endDate"
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(event) => setEndDate(event.target.value)}
          />
          <Input
            label={t('quotes.ask.adults')}
            name="adults"
            type="number"
            inputMode="numeric"
            min={1}
            max={9}
            value={adults}
            required
            onChange={(event) => setAdults(event.target.value)}
          />
          <Input
            label={t('quotes.ask.children')}
            name="children"
            type="number"
            inputMode="numeric"
            min={0}
            max={8}
            value={children}
            required
            onChange={(event) => setChildren(event.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {error}
          </p>
        ) : null}
        {sent ? (
          <p role="status" className="font-body text-body-sm text-foreground">
            {t('quotes.ask.sent')}
          </p>
        ) : null}
        <Button type="submit" loading={busy} data-testid="quote-ask-submit">
          {t('quotes.ask.submit')}
        </Button>
      </form>
    </Card>
  );
}

/**
 * A traveller's price requests (ADR-104): the form that asks for one, and each request with
 * where it stands. A request is its account's: without a session the page says what signing
 * in adds, and while price requests are switched off it shows nothing to ask with.
 */
export function PriceRequests({ currency }: { currency: string }) {
  const { t } = useQuotesT();
  const format = useFormatters();
  const hydrated = useHydrated();
  const signedIn = hydrated && hasSession();
  const [quotes, setQuotes] = useState<AssistedQuote[] | null>(null);
  const [offered, setOffered] = useState(true);
  // Counts the requests made on this page: the list is read again after each.
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    browserApi()
      .GET('/v1/me/assisted-quotes')
      .then(({ data, response }) => {
        if (cancelled) return;
        // 404 while price requests are switched off: nothing to ask with.
        if (response.status === 404) setOffered(false);
        setQuotes(data?.quotes ?? []);
      })
      .catch(() => {
        if (!cancelled) setQuotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, asked]);

  if (!hydrated) return null;
  if (!signedIn) {
    return (
      <p className="font-body text-body text-foreground">
        {t('quotes.signIn')}{' '}
        <AppLink href="/sign-in?next=/quotes" className={LINK}>
          {t('quotes.link')}
        </AppLink>
      </p>
    );
  }
  if (!offered) {
    return <p className="font-body text-body text-foreground">{t('quotes.notFound')}</p>;
  }
  return (
    <div className="flex flex-col gap-8 lg:grid lg:grid-cols-2 lg:items-start">
      <AskForm currency={currency} onAsked={() => setAsked((count) => count + 1)} />
      <section aria-labelledby="quote-list" className="flex flex-col gap-3">
        <h2 id="quote-list" className="font-heading text-h3 font-bold text-heading">
          {t('quotes.heading')}
        </h2>
        {quotes === null ? null : quotes.length === 0 ? (
          <p className="font-body text-body-sm text-muted">{t('quotes.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="quote-list">
            {quotes.map((quote) => (
              <li key={quote.id}>
                <Card className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-body text-body font-bold text-heading">
                      {quote.title}
                    </span>
                    <Badge variant={STATUS_VARIANT[quote.status]}>
                      {t(`quotes.statuses.${quote.status}`)}
                    </Badge>
                  </div>
                  <span className="font-body text-body-sm text-foreground">
                    {quote.request.destination}
                    {', '}
                    <span suppressHydrationWarning>
                      {quote.request.endDate
                        ? format.dateRange(quote.request.startDate, quote.request.endDate, 'medium')
                        : format.date(quote.request.startDate, 'medium')}
                    </span>
                  </span>
                  {quote.offer ? (
                    <span className="font-body text-body font-bold text-heading">
                      {format.money(quote.offer.total)}
                    </span>
                  ) : null}
                  <AppLink
                    href={`/quotes/${quote.id}`}
                    aria-label={t('quotes.view', { reference: quote.reference })}
                    className={LINK}
                  >
                    {t('quotes.reference', { reference: quote.reference })}
                  </AppLink>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * One price request (ADR-104): what was asked, where it stands, and the offer once a person
 * has verified the price. The offer is booked through the ordinary checkout; nothing here
 * books or pays.
 */
export function PriceRequest({ quoteId }: { quoteId: string }) {
  const { t } = useQuotesT();
  const format = useFormatters();
  const [quote, setQuote] = useState<AssistedQuote | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    browserApi()
      .GET('/v1/quotes/assisted/{assistedQuoteId}', {
        params: { path: { assistedQuoteId: quoteId } },
      })
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setQuote(data);
        else setMissing(true);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [quoteId]);

  const withdraw = async () => {
    setBusy(true);
    try {
      const { data } = await browserApi().POST('/v1/quotes/assisted/{assistedQuoteId}/withdraw', {
        params: { path: { assistedQuoteId: quoteId } },
      });
      if (data) setQuote(data);
    } finally {
      setBusy(false);
    }
  };

  if (missing) {
    return (
      <p role="alert" className="font-body text-body text-foreground" data-testid="quote-missing">
        {t('quotes.notFound')}
      </p>
    );
  }
  if (!quote) return null;
  const { request, offer } = quote;
  const closedKey =
    quote.closedReason === null
      ? null
      : quote.closedReason === 'other'
        ? 'another'
        : quote.closedReason;
  return (
    <Card className="flex max-w-dialog flex-col gap-4 p-6" data-testid="quote-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-h3 font-bold text-heading">{quote.title}</h2>
        <Badge variant={STATUS_VARIANT[quote.status]} data-testid="quote-status">
          {t(`quotes.statuses.${quote.status}`)}
        </Badge>
      </div>
      <p className="font-body text-body-sm text-muted">
        {t('quotes.reference', { reference: quote.reference })}
      </p>
      <p className="font-body text-body text-foreground">
        {[request.origin, request.destination].filter(Boolean).join(' → ')}
        {', '}
        <span suppressHydrationWarning>
          {request.endDate
            ? format.dateRange(request.startDate, request.endDate, 'medium')
            : format.date(request.startDate, 'medium')}
        </span>
      </p>
      <p className="font-body text-body-sm text-foreground">
        {t('quotes.people', {
          adults: format.number(request.adults),
          children: format.number(request.children),
        })}
      </p>
      {quote.indicative ? (
        <p className="font-body text-body-sm text-muted">
          {t('quotes.indicative', {
            price: format.money(quote.indicative.price),
            source: quote.indicative.source,
            date: format.date(quote.indicative.seenAt.slice(0, 10), 'medium'),
          })}
        </p>
      ) : null}
      {quote.status === 'requested' ? (
        <>
          <p className="font-body text-body-sm text-foreground" suppressHydrationWarning>
            {t('quotes.answerBy', { time: format.dateTime(quote.answerBy) })}
          </p>
          <Button
            variant="ghost"
            loading={busy}
            className="self-start"
            onClick={() => void withdraw()}
            data-testid="quote-withdraw"
          >
            {t('quotes.withdraw')}
          </Button>
        </>
      ) : null}
      {offer ? (
        <section aria-labelledby="quote-offer" className="flex flex-col gap-2">
          <h3 id="quote-offer" className="font-heading text-h4 font-bold text-heading">
            {t('quotes.offer.heading')}
          </h3>
          <p className="font-body text-body font-bold text-foreground">{offer.details.title}</p>
          <p className="font-body text-body-sm whitespace-pre-wrap text-foreground">
            {offer.details.summary}
          </p>
          <p className="font-body text-body-sm text-foreground">
            {offer.details.refundable
              ? t('quotes.offer.refundable')
              : t('quotes.offer.nonRefundable')}
          </p>
          <p className="font-body text-body text-foreground">
            {t('quotes.offer.total')}{' '}
            <span className="font-bold text-heading" data-testid="quote-total">
              {format.money(offer.total)}
            </span>
          </p>
          <p className="font-body text-body-sm text-muted">{t('quotes.offer.verified')}</p>
          {quote.status === 'offered' ? (
            <>
              <p className="font-body text-body-sm text-foreground" suppressHydrationWarning>
                {t('quotes.offer.until', { time: format.dateTime(offer.expiresAt) })}
              </p>
              <p className="font-body text-body-sm text-foreground">
                {t('quotes.offer.afterPayment')}
              </p>
              <AppLink
                href={`/checkout/${offer.quoteId}`}
                className="inline-flex min-h-12 items-center justify-center self-start rounded-pill bg-primary px-6 font-body text-body font-bold text-on-primary hover:bg-primary-hover focus-visible:focus-ring"
                data-testid="quote-book"
              >
                {t('quotes.offer.book')}
              </AppLink>
            </>
          ) : null}
        </section>
      ) : null}
      {closedKey ? (
        <p className="font-body text-body-sm text-foreground" data-testid="quote-closed">
          {t(`quotes.closed.${closedKey as 'another'}`)}
        </p>
      ) : null}
      {quote.bookingId ? (
        <AppLink href={`/bookings/${quote.bookingId}`} className={LINK}>
          {t('quotes.viewBooking')}
        </AppLink>
      ) : null}
    </Card>
  );
}
