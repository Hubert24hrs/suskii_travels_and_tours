'use client';

import type { LocaleCode } from '@suskii/shared/lite';
import { useFormatters } from '@suskii/i18n/react';
import { Button, Card, Dialog, DialogContent, Input } from '@suskii/ui-web';
import { Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { bookingHeaders, saveBookingToken } from '../../lib/booking-token';
import { browserApi, idempotencyKey, problemSlug, type Schemas } from '../../lib/browser-api';
import { searchAgainHref } from '../../lib/search-links';
import { AppLink } from '../app-link';
import { loadTurnstile } from '../home/turnstile';
import { ResultsLoading } from '../results/result-states';

import { useBookingT } from './checkout-messages';
import {
  emptyPassenger,
  normalisePassport,
  normalisePhone,
  validateCheckout,
  type CheckoutDraft,
  type CheckoutIssue,
  type FieldIssues,
  type PassengerDraft,
} from './checkout-validation';
import { GuestFields, PassengerFields, type CountryOption } from './passenger-fields';
import { flightFacts, PriceSummary, TripSummary, type PriceLines } from './summaries';

type Quote = Schemas['Quote'];
type Money = Schemas['Money'];
interface PriceChange {
  previous: Money;
  current: Money;
  difference: Money;
}
type Promo = Schemas['PromoValidation'];

const DEVELOPMENT_TOKEN = 'development';

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; quote: Quote }
  | { kind: 'expired'; searchHref: string }
  | { kind: 'missing' };

const ISSUE_CODES: readonly CheckoutIssue[] = [
  'name_not_latin',
  'name_too_long',
  'passport_required',
  'passport_expired',
  'passport_expires_soon',
  'passenger_type_mismatch',
  'born_after_travel',
  'infants_exceed_adults',
  'passenger_count_mismatch',
  'traveller_not_found',
];
const asIssue = (code: string): CheckoutIssue =>
  (ISSUE_CODES as readonly string[]).includes(code) ? (code as CheckoutIssue) : 'invalid';

/** API field paths (`passengers.0.document.number`) to form paths (`passengers.0.passportNumber`). */
function formPath(apiPath: string): string {
  return apiPath
    .replace(/^contact\./, '')
    .replace(/\.document\.number$/, '.passportNumber')
    .replace(/\.document\.expiryDate$/, '.passportExpiry')
    .replace(/\.document\.issuingCountry$/, '.issuingCountry')
    .replace(/\.document$/, '.passportNumber');
}

function draftFor(quote: Quote): CheckoutDraft {
  const counts = quote.flight?.offer.passengers;
  const passengers: PassengerDraft[] = counts
    ? [
        ...Array.from({ length: counts.adults }, () => emptyPassenger('adult')),
        ...Array.from({ length: counts.children }, () => emptyPassenger('child')),
        ...Array.from({ length: counts.infants }, () => emptyPassenger('infant')),
      ]
    : [];
  const guests = quote.hotel
    ? quote.hotel.request.rooms.map(() => ({ givenNames: '', surname: '' }))
    : [];
  return { passengers, guests, email: '', phone: '', terms: false };
}

/**
 * Checkout (ADR-014): travellers, contact, extra bags, promo code and terms, then the booking is
 * created and the price re-checked right before payment. A changed price asks for consent in a
 * dialog; the traveller then continues to the hosted payment page.
 */
export function Checkout({
  quoteId,
  countries,
  turnstileSiteKey,
  locale,
}: {
  quoteId: string;
  countries: readonly CountryOption[];
  turnstileSiteKey: string;
  locale: LocaleCode;
}) {
  const { t } = useBookingT();
  const format = useFormatters();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [draft, setDraft] = useState<CheckoutDraft | null>(null);
  const [errors, setErrors] = useState<FieldIssues>({});
  const [warnings, setWarnings] = useState<FieldIssues>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<Promo | null>(null);
  const [promoError, setPromoError] = useState(false);
  const [promoBusy, setPromoBusy] = useState(false);
  const [priceChange, setPriceChange] = useState<PriceChange | null>(null);
  const booking = useRef<{ id: string } | null>(null);
  const createKey = useRef<{ body: string; key: string } | null>(null);
  const token = useRef<string | null>(turnstileSiteKey ? null : DEVELOPMENT_TOKEN);
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    browserApi()
      .GET('/v1/quotes/{quoteId}', { params: { path: { quoteId } } })
      .then(({ data, error, response }) => {
        if (cancelled) return;
        if (data) {
          setPhase({ kind: 'ready', quote: data });
          setDraft(draftFor(data));
        } else if (response.status === 410) {
          const request = (error as { request?: unknown } | undefined)?.request;
          setPhase({ kind: 'expired', searchHref: searchAgainHref(request) });
        } else setPhase({ kind: 'missing' });
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: 'missing' });
      });
    return () => {
      cancelled = true;
    };
  }, [quoteId]);

  const quote = phase.kind === 'ready' ? phase.quote : null;
  const services = useMemo(() => quote?.flight?.offer.services ?? [], [quote]);
  const facts = useMemo(() => (quote?.flight ? flightFacts(quote.flight.offer) : null), [quote]);

  const lines: PriceLines | null = useMemo(() => {
    if (!quote || !draft) return null;
    const price = promo?.price ?? quote.flight?.offer.price ?? quote.hotel?.rate.price;
    if (!price) return null;
    const bag = services[0];
    const bagCount = draft.passengers.reduce((acc, passenger) => acc + passenger.bags, 0);
    const extras =
      bag && bagCount > 0
        ? { amountMinor: bag.price.amountMinor * bagCount, currency: bag.price.currency }
        : null;
    return {
      price,
      extras,
      total: {
        amountMinor: price.total.amountMinor + (extras?.amountMinor ?? 0),
        currency: price.total.currency,
      },
      payAtProperty: quote.hotel?.rate.payAtProperty ?? null,
    };
  }, [quote, draft, promo, services]);

  const ensureTurnstile = () => {
    if (!turnstileSiteKey || widgetId.current || !widget.current) return;
    const container = widget.current;
    loadTurnstile()
      .then((turnstile) => {
        widgetId.current = turnstile.render(container, {
          sitekey: turnstileSiteKey,
          action: 'checkout',
          callback: (value) => {
            token.current = value;
          },
          'expired-callback': () => {
            token.current = null;
          },
        });
      })
      .catch(() => setFormError(t('checkout.errors.bot')));
  };

  if (phase.kind === 'loading' || (phase.kind === 'ready' && !draft))
    return <ResultsLoading label={t('checkout.loadingQuote')} />;
  if (phase.kind === 'missing')
    return (
      <Card role="alert" className="flex flex-col items-start gap-4 p-6">
        <p className="font-body text-body text-foreground">{t('checkout.errors.generic')}</p>
        <Button asChild variant="secondary">
          <AppLink href="/">{t('booking.notFound.home')}</AppLink>
        </Button>
      </Card>
    );
  if (phase.kind === 'expired' || !quote || !draft || !lines)
    return (
      <Card role="status" className="flex flex-col items-start gap-4 p-6">
        <h2 className="font-heading text-h3 font-bold text-heading">
          {t('checkout.expired.heading')}
        </h2>
        <p className="font-body text-body text-foreground">{t('checkout.expired.body')}</p>
        <Button asChild variant="secondary">
          <AppLink href={phase.kind === 'expired' ? phase.searchHref : '/'}>
            {t('checkout.expired.cta')}
          </AppLink>
        </Button>
      </Card>
    );

  const update = (patch: Partial<CheckoutDraft>) => {
    ensureTurnstile();
    setDraft({ ...draft, ...patch });
  };
  const updatePassenger = (index: number, patch: Partial<PassengerDraft>) =>
    update({
      passengers: draft.passengers.map((passenger, i) =>
        i === index ? { ...passenger, ...patch } : passenger,
      ),
    });

  const applyPromo = async () => {
    setPromoBusy(true);
    setPromoError(false);
    const { data } = await browserApi().POST('/v1/pricing/promos/validate', {
      body: { code: promoInput, quoteId },
    });
    setPromoBusy(false);
    if (data) setPromo(data);
    else setPromoError(true);
  };

  const startPayment = async (bookingId: string) => {
    const { data, error, response } = await browserApi().POST('/v1/bookings/{bookingId}/payments', {
      params: {
        path: { bookingId },
        header: { 'Idempotency-Key': idempotencyKey(), ...bookingHeaders(bookingId) },
      },
    });
    if (data) {
      window.location.assign(data.checkoutUrl);
      return;
    }
    const slug = problemSlug(error);
    if (slug === 'price-changed') {
      const change = (error as { priceChange?: PriceChange }).priceChange;
      if (change) setPriceChange(change);
    } else if (response.status === 410) {
      const request = (error as { request?: unknown }).request;
      setPhase({ kind: 'expired', searchHref: searchAgainHref(request) });
    } else if (response.status === 409) {
      router.push(`/bookings/${bookingId}`);
    } else {
      setFormError(
        response.status === 503 ? t('checkout.errors.unavailable') : t('checkout.errors.generic'),
      );
    }
  };

  const acceptPrice = async () => {
    const bookingId = booking.current?.id;
    if (!bookingId || !priceChange) return;
    setSubmitting(true);
    const { data, error } = await browserApi().POST('/v1/bookings/{bookingId}/price-consent', {
      params: { path: { bookingId } },
      headers: bookingHeaders(bookingId),
      body: { total: priceChange.current },
    });
    if (data) {
      setPriceChange(null);
      await startPayment(bookingId);
    } else if (problemSlug(error) === 'price-consent-mismatch') {
      // The price moved again: ask the supplier once more and show the latest figure.
      setPriceChange(null);
      await startPayment(bookingId);
    } else {
      setFormError(t('checkout.errors.generic'));
    }
    setSubmitting(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const checked = validateCheckout(draft, facts);
    setErrors(checked.errors);
    setWarnings(checked.warnings);
    if (Object.keys(checked.errors).length > 0) {
      summaryRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      if (booking.current) {
        await startPayment(booking.current.id);
        return;
      }
      if (!token.current) {
        ensureTurnstile();
        setFormError(t('checkout.errors.bot'));
        return;
      }
      const body = {
        quoteId,
        contact: { email: draft.email.trim(), phone: normalisePhone(draft.phone) },
        passengers: draft.passengers.map((passenger) => ({
          type: passenger.type,
          title: passenger.title as 'mr',
          gender: passenger.gender as 'm',
          givenNames: passenger.givenNames,
          surname: passenger.surname,
          dateOfBirth: passenger.dateOfBirth,
          nationality: passenger.nationality,
          document: passenger.passportNumber
            ? {
                number: normalisePassport(passenger.passportNumber),
                issuingCountry: passenger.issuingCountry,
                expiryDate: passenger.passportExpiry,
              }
            : null,
        })),
        guests: draft.guests,
        extras: draft.passengers.flatMap((passenger, index) =>
          services[0] && passenger.bags > 0
            ? [{ serviceId: services[0].id, passengerIndex: index, quantity: passenger.bags }]
            : [],
        ),
        promoCode: promo?.code ?? null,
        termsVersion: quote.termsVersion,
        acceptTerms: true as const,
        locale,
        turnstileToken: token.current,
      };
      const serialised = JSON.stringify(body);
      if (createKey.current?.body !== serialised)
        createKey.current = { body: serialised, key: idempotencyKey() };
      const { data, error, response } = await browserApi().POST('/v1/bookings', {
        params: { header: { 'Idempotency-Key': createKey.current.key } },
        body,
      });
      if (data) {
        booking.current = { id: data.booking.id };
        if (data.accessToken) saveBookingToken(data.booking.id, data.accessToken);
        await startPayment(data.booking.id);
        return;
      }
      // Turnstile tokens are single use.
      if (turnstileSiteKey && widgetId.current) {
        token.current = null;
        window.turnstile?.reset(widgetId.current);
      }
      const slug = problemSlug(error);
      const problem = error as {
        issues?: { index: number | null; path: string[]; code: string }[];
        errors?: { path: string; message: string }[];
        request?: unknown;
      };
      if (slug === 'passengers-invalid' && problem.issues) {
        const mapped: FieldIssues = {};
        for (const issue of problem.issues) {
          const key =
            issue.index === null
              ? issue.path[0] === 'guests'
                ? 'guests'
                : 'passengers'
              : formPath(`passengers.${issue.index}.${issue.path.join('.')}`);
          mapped[key] = asIssue(issue.code);
        }
        setErrors(mapped);
        setFormError(t('checkout.issues.summary'));
      } else if (slug === 'validation-failed' && problem.errors) {
        const mapped: FieldIssues = {};
        for (const issue of problem.errors) mapped[formPath(issue.path)] = asIssue(issue.message);
        setErrors(mapped);
        setFormError(t('checkout.issues.summary'));
      } else if (slug === 'offer-unavailable' || response.status === 410) {
        setPhase({ kind: 'expired', searchHref: searchAgainHref(problem.request) });
      } else if (slug === 'terms-outdated') setFormError(t('checkout.errors.terms'));
      else if (slug === 'bot-check-failed') setFormError(t('checkout.errors.bot'));
      else if (slug === 'extras-invalid') setFormError(t('checkout.errors.extras'));
      else if (slug === 'promo-invalid') {
        setPromo(null);
        setPromoError(true);
      } else if (response.status === 429) setFormError(t('checkout.errors.tooMany'));
      else setFormError(t('checkout.errors.generic'));
    } catch {
      setFormError(t('checkout.errors.generic'));
    } finally {
      setSubmitting(false);
    }
  };

  const errorCount = Object.keys(errors).length;
  const listIssue = errors.passengers ?? errors.guests;
  const travellerNumbers = { adult: 0, child: 0, infant: 0 };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start lg:gap-8"
    >
      <div className="flex flex-col gap-6 lg:col-span-2">
        <div ref={summaryRef} tabIndex={-1} className="focus-visible:focus-ring">
          {errorCount > 0 || formError ? (
            <p
              role="alert"
              className="rounded-md border border-danger bg-surface p-4 font-body text-body-sm text-danger"
            >
              {formError ?? t('checkout.issues.summary')}
              {listIssue ? ` ${t(`checkout.issues.${listIssue}`)}` : ''}
            </p>
          ) : null}
        </div>

        {draft.passengers.length > 0 ? (
          <section aria-labelledby="checkout-travellers" className="flex flex-col gap-4">
            <h2 id="checkout-travellers" className="font-heading text-h3 font-bold text-heading">
              {t('checkout.travellers')}
            </h2>
            {draft.passengers.map((passenger, index) => {
              travellerNumbers[passenger.type] += 1;
              return (
                <PassengerFields
                  key={index}
                  index={index}
                  label={t(`checkout.traveller.${passenger.type}`, {
                    number: travellerNumbers[passenger.type],
                  })}
                  value={passenger}
                  onChange={(patch) => updatePassenger(index, patch)}
                  countries={countries}
                  passportRequired={facts?.international ?? false}
                  services={services}
                  errors={errors}
                  warnings={warnings}
                />
              );
            })}
          </section>
        ) : null}

        {draft.guests.length > 0 ? (
          <section aria-labelledby="checkout-guests" className="flex flex-col gap-4">
            <h2 id="checkout-guests" className="font-heading text-h3 font-bold text-heading">
              {t('booking.guests')}
            </h2>
            {draft.guests.map((guest, index) => (
              <GuestFields
                key={index}
                index={index}
                value={guest}
                errors={errors}
                onChange={(patch) =>
                  update({
                    guests: draft.guests.map((g, i) => (i === index ? { ...g, ...patch } : g)),
                  })
                }
              />
            ))}
          </section>
        ) : null}

        <Card asChild className="flex flex-col gap-4 p-4">
          <section aria-labelledby="checkout-contact">
            <h2 id="checkout-contact" className="font-heading text-h3 font-bold text-heading">
              {t('checkout.contact')}
            </h2>
            <p className="font-body text-body-sm text-foreground">{t('checkout.contactHint')}</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                id="contact-email"
                type="email"
                autoComplete="email"
                label={t('checkout.fields.email')}
                value={draft.email}
                onChange={(event) => update({ email: event.target.value })}
                error={errors.email ? t(`checkout.issues.${errors.email}`) : undefined}
              />
              <Input
                id="contact-phone"
                type="tel"
                autoComplete="tel"
                label={t('checkout.fields.phone')}
                hint={t('checkout.fields.phoneHint')}
                value={draft.phone}
                onChange={(event) => update({ phone: event.target.value })}
                error={errors.phone ? t(`checkout.issues.${errors.phone}`) : undefined}
              />
            </div>
          </section>
        </Card>

        <Card asChild className="flex flex-col gap-3 p-4">
          <section aria-labelledby="checkout-promo">
            <h2 id="checkout-promo" className="font-heading text-h4 font-bold text-heading">
              {t('checkout.promo')}
            </h2>
            {promo?.discount ? (
              <div className="flex flex-wrap items-center gap-3">
                <p role="status" className="font-body text-body-sm text-foreground">
                  {t('checkout.promoApplied', {
                    code: promo.code,
                    amount: format.money(promo.discount),
                  })}
                </p>
                <Button variant="ghost" onClick={() => setPromo(null)}>
                  {t('checkout.promoRemove')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 md:flex-row md:items-end">
                <Input
                  id="checkout-promo-input"
                  autoComplete="off"
                  label={t('checkout.promo')}
                  hideLabel
                  value={promoInput}
                  onChange={(event) => setPromoInput(event.target.value)}
                  error={promoError ? t('checkout.promoInvalid') : undefined}
                />
                <Button
                  variant="secondary"
                  loading={promoBusy}
                  disabled={promoInput.trim().length < 3}
                  onClick={() => void applyPromo()}
                >
                  {t('checkout.promoApply')}
                </Button>
              </div>
            )}
          </section>
        </Card>

        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-3 font-body text-body-sm text-foreground">
            <input
              type="checkbox"
              name="terms"
              className="mt-1 size-5 shrink-0 accent-primary"
              checked={draft.terms}
              aria-invalid={errors.terms ? true : undefined}
              aria-describedby={errors.terms ? 'terms-error' : undefined}
              onChange={(event) => update({ terms: event.target.checked })}
            />
            {t('checkout.terms')}
          </label>
          {errors.terms ? (
            <p id="terms-error" className="font-body text-caption text-danger">
              {t('checkout.issues.terms')}
            </p>
          ) : null}
          <div ref={widget} />
          <Button type="submit" fullWidth="mobile" loading={submitting}>
            {submitting ? t('checkout.paying') : t('checkout.pay')}
          </Button>
          <p className="flex items-center gap-2 font-body text-caption text-foreground">
            <Lock aria-hidden="true" className="size-4" />
            {t('checkout.secure')}
          </p>
        </div>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
        <TripSummary quote={quote} />
        <PriceSummary lines={lines} />
      </aside>

      <Dialog
        open={priceChange !== null}
        onOpenChange={(open) => (open ? undefined : setPriceChange(null))}
      >
        {priceChange ? (
          <DialogContent
            title={t('checkout.priceChange.title')}
            description={t('checkout.priceChange.body')}
            closeLabel={t('common.close')}
          >
            <dl className="flex flex-col gap-2 font-body text-body text-foreground">
              <div className="flex justify-between gap-4">
                <dt>{t('checkout.priceChange.previous')}</dt>
                <dd>{format.money(priceChange.previous)}</dd>
              </div>
              <div className="flex justify-between gap-4 font-bold">
                <dt>{t('checkout.priceChange.current')}</dt>
                <dd data-testid="new-total">{format.money(priceChange.current)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>{t('checkout.priceChange.difference')}</dt>
                <dd>{format.money(priceChange.difference)}</dd>
              </div>
            </dl>
            <div className="flex flex-col gap-2 md:flex-row md:justify-end">
              <Button variant="ghost" onClick={() => setPriceChange(null)}>
                {t('checkout.priceChange.decline')}
              </Button>
              <Button loading={submitting} onClick={() => void acceptPrice()}>
                {t('checkout.priceChange.accept')}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </form>
  );
}
