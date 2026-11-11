import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { assistedQuoteInputSchema } from '@suskii/shared';
import { Badge, Button, Card, DateRangePicker, Input, useToast } from '@suskii/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { Stepper } from '../components/search/rooms-picker';
import { Loading, Notice } from '../components/states';
import { problemSlug } from '../lib/api';
import { fromIso, toIso } from '../lib/dates';
import { sharePlanPdf } from '../lib/plan-pdf';
import { useApp, useT } from '../providers/app-provider';

type AssistedQuote = Schemas['AssistedQuote'];

const PRODUCTS = ['flight', 'hotel', 'car', 'transfer', 'tour', 'package', 'other'] as const;
type Product = (typeof PRODUCTS)[number];

const STATUS_VARIANT = {
  requested: 'info',
  offered: 'success',
  booked: 'success',
  unavailable: 'neutral',
  expired: 'neutral',
  withdrawn: 'neutral',
} as const;

const LIST_KEY = ['assisted-quotes'] as const;
/** While a request waits for a person, or an offer for the traveller, the answer is looked for. */
const POLL_MS = 30_000;

/** The dates of a request as one line: a range, or its single day. */
function useDates(): (request: AssistedQuote['request']) => string {
  const format = useFormatters();
  return (request) =>
    request.endDate
      ? format.dateRange(request.startDate, request.endDate, 'medium')
      : format.date(request.startDate, 'medium');
}

/**
 * Asks for a price to be confirmed (ADR-104): what is wanted in a few words, where, when and
 * for how many. No names and no contact details: the API refuses text that looks like one,
 * and the same rule is checked here first.
 */
function AskForm({ onAsked }: { onAsked: () => void }) {
  const { api, currency, locale } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const [product, setProduct] = useState<Product>('hotel');
  const [what, setWhat] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setError(null);
    setSent(false);
    const input = assistedQuoteInputSchema.safeParse({
      product,
      title: what,
      request: {
        origin: origin.trim() || null,
        destination,
        startDate,
        endDate: endDate || null,
        adults,
        children,
      },
      currency,
      observationId: null,
    });
    if (!input.success) {
      const contact = input.error.issues.some((issue) => issue.message === 'no_contact_details');
      setError(contact ? t('quotes.errors.contact') : t('quotes.errors.generic'));
      return;
    }
    setBusy(true);
    try {
      const { data, error: problem } = await api.POST('/v1/quotes/assisted', {
        params: { header: { 'Idempotency-Key': randomUUID() } },
        body: input.data,
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

  const day = (
    testID: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    minDate?: Date,
  ) => (
    <DateRangePicker
      testID={testID}
      mode="single"
      label={label}
      value={{ from: fromIso(value), to: undefined }}
      onChange={(range) => onChange(range.from ? toIso(range.from) : '')}
      formatValue={(range) => (range.from ? format.date(toIso(range.from), 'weekday') : undefined)}
      placeholder={t('trips.plan.datesPlaceholder')}
      locale={locale}
      labels={{ done: t('search.datePicker.done'), close: t('search.datePicker.close') }}
      {...(minDate ? { minDate } : {})}
    />
  );

  return (
    <Card testID="quote-ask" className="gap-4 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('quotes.ask.heading')}
      </Text>
      <View className="gap-2">
        <Text className="font-body-bold text-body-sm text-foreground">
          {t('quotes.ask.product')}
        </Text>
        <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
          {PRODUCTS.map((value) => (
            <Pressable
              key={value}
              testID={`quote-product-${value}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: product === value }}
              onPress={() => setProduct(value)}
              className={
                product === value
                  ? 'min-h-12 justify-center rounded-md bg-primary-subtle px-3'
                  : 'min-h-12 justify-center rounded-md border border-border-strong px-3'
              }
            >
              <Text className="font-body text-body-sm text-foreground">
                {t(`quotes.ask.products.${value === 'other' ? 'another' : value}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Input
        testID="quote-what"
        label={t('quotes.ask.what')}
        hint={t('quotes.ask.whatHint')}
        value={what}
        onChangeText={setWhat}
        maxLength={160}
      />
      <Input
        testID="quote-origin"
        label={t('quotes.ask.origin')}
        value={origin}
        onChangeText={setOrigin}
        maxLength={80}
      />
      <Input
        testID="quote-destination"
        label={t('quotes.ask.destination')}
        value={destination}
        onChangeText={setDestination}
        maxLength={80}
      />
      {day('quote-start', t('quotes.ask.startDate'), startDate, (next) => {
        setStartDate(next);
        // An end before the new start would be refused: it is asked for again.
        if (endDate && next && endDate < next) setEndDate('');
      })}
      {day('quote-end', t('quotes.ask.endDate'), endDate, setEndDate, fromIso(startDate))}
      <Stepper
        label={t('quotes.ask.adults')}
        value={adults}
        min={1}
        max={9}
        onChange={setAdults}
        incrementLabel={t('search.travellers.addAdult')}
        decrementLabel={t('search.travellers.removeAdult')}
      />
      <Stepper
        label={t('quotes.ask.children')}
        value={children}
        min={0}
        max={8}
        onChange={setChildren}
        incrementLabel={t('search.travellers.addChild')}
        decrementLabel={t('search.travellers.removeChild')}
      />
      {error ? (
        <Text
          testID="quote-ask-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          className="font-body text-body-sm text-danger"
        >
          {error}
        </Text>
      ) : null}
      {sent ? (
        <Text
          testID="quote-ask-sent"
          accessibilityLiveRegion="polite"
          className="font-body text-body-sm text-foreground"
        >
          {t('quotes.ask.sent')}
        </Text>
      ) : null}
      <Button testID="quote-ask-submit" loading={busy} onPress={() => void submit()}>
        {t('quotes.ask.submit')}
      </Button>
    </Card>
  );
}

function Requests() {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const dates = useDates();
  const router = useRouter();
  const quotes = useQuery({
    queryKey: LIST_KEY,
    queryFn: async () => {
      const { data, response } = await api.GET('/v1/me/assisted-quotes');
      // 404 while price requests are switched off: there is nothing to ask with.
      if (response.status === 404) return null;
      if (!data) throw new Error('assisted-quotes');
      return data.quotes;
    },
    refetchInterval: (query) =>
      query.state.data?.some((quote) => quote.status === 'requested') ? POLL_MS : false,
  });

  if (quotes.isPending) return <Loading label={t('mobile.loading')} />;
  if (quotes.isError) {
    return (
      <Notice
        body={t('account.loadError')}
        action={t('account.retry')}
        onAction={() => void quotes.refetch()}
      />
    );
  }
  if (quotes.data === null) return <Notice testID="quotes-off" body={t('quotes.notFound')} />;

  return (
    <ScrollView
      testID="price-requests"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="font-body text-body text-foreground">{t('quotes.intro')}</Text>
      <AskForm onAsked={() => void quotes.refetch()} />
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('quotes.heading')}
      </Text>
      {quotes.data.length === 0 ? (
        <Card className="p-4">
          <Text className="font-body text-body text-muted">{t('quotes.empty')}</Text>
        </Card>
      ) : (
        quotes.data.map((quote) => (
          <Pressable
            key={quote.id}
            testID={`quote-${quote.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('quotes.view', { reference: quote.reference })}
            onPress={() => router.push(`/account/quotes/${quote.id}` as Href)}
          >
            <Card className="gap-2 p-4">
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <Text className="flex-1 font-body-bold text-body text-heading">{quote.title}</Text>
                <Badge variant={STATUS_VARIANT[quote.status]}>
                  {t(`quotes.statuses.${quote.status}`)}
                </Badge>
              </View>
              <Text className="font-body text-body-sm text-foreground">
                {`${quote.request.destination}, ${dates(quote.request)}`}
              </Text>
              {quote.offer ? (
                <Text className="font-body-bold text-body text-heading">
                  {format.money(quote.offer.total)}
                </Text>
              ) : null}
              <Text className="font-body text-body-sm text-muted">
                {t('quotes.reference', { reference: quote.reference })}
              </Text>
            </Card>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

/**
 * A traveller's price requests (ADR-104): the form that asks for one, and each request with
 * where it stands. A request is its account's, so the screen needs a session.
 */
export function PriceRequestsScreen() {
  const { t } = useT();
  return (
    <>
      <Stack.Screen options={{ title: t('quotes.heading') }} />
      <RequireAccount>
        <Requests />
      </RequireAccount>
    </>
  );
}

function Request({ id }: { id: string }) {
  const { api, session } = useApp();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const { t } = useT();
  const format = useFormatters();
  const dates = useDates();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const quote = useQuery({
    queryKey: [...LIST_KEY, id],
    queryFn: async () => {
      const { data, response } = await api.GET('/v1/quotes/assisted/{assistedQuoteId}', {
        params: { path: { assistedQuoteId: id } },
      });
      // Another account's request, or price requests switched off: it is not there.
      if (response.status === 404) return null;
      if (!data) throw new Error('assisted-quote');
      return data;
    },
    // An answer arrives while the traveller waits; an offer runs out while they read it.
    refetchInterval: (query) =>
      query.state.data?.status === 'requested' || query.state.data?.status === 'offered'
        ? POLL_MS
        : false,
  });

  if (quote.isPending) return <Loading label={t('mobile.loading')} />;
  if (quote.isError) {
    return (
      <Notice
        body={t('account.loadError')}
        action={t('account.retry')}
        onAction={() => void quote.refetch()}
      />
    );
  }
  if (!quote.data) return <Notice testID="quote-missing" body={t('quotes.notFound')} />;

  const { request, offer } = quote.data;
  const withdraw = async () => {
    setBusy(true);
    try {
      const { data } = await api.POST('/v1/quotes/assisted/{assistedQuoteId}/withdraw', {
        params: { path: { assistedQuoteId: id } },
      });
      if (data) {
        queryClient.setQueryData([...LIST_KEY, id], data);
        void queryClient.invalidateQueries({ queryKey: LIST_KEY, exact: true });
      }
    } finally {
      setBusy(false);
    }
  };
  const closedKey =
    quote.data.closedReason === null
      ? null
      : quote.data.closedReason === 'other'
        ? 'another'
        : quote.data.closedReason;
  const bookingId = quote.data.bookingId;
  const reference = quote.data.reference;
  /** The request, with its offer once there is one, as a PDF to keep or pass on. */
  const savePdf = async () => {
    setSaving(true);
    try {
      await sharePlanPdf(
        session,
        `/v1/quotes/assisted/${id}/pdf`,
        `suskii-price-request-${reference}.pdf`,
        t('quotes.pdf'),
      );
    } catch {
      toast({ title: t('mobile.trip.downloadFailed'), variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      testID="quote-detail"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      <Card className="gap-3 p-4">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Text accessibilityRole="header" className="flex-1 font-heading text-h4 text-heading">
            {quote.data.title}
          </Text>
          <View testID="quote-status">
            <Badge variant={STATUS_VARIANT[quote.data.status]}>
              {t(`quotes.statuses.${quote.data.status}`)}
            </Badge>
          </View>
        </View>
        <Text className="font-body text-body-sm text-muted">
          {t('quotes.reference', { reference: quote.data.reference })}
        </Text>
        <Text className="font-body text-body text-foreground">
          {`${[request.origin, request.destination].filter(Boolean).join(' → ')}, ${dates(request)}`}
        </Text>
        <Text className="font-body text-body-sm text-foreground">
          {t('quotes.people', {
            adults: format.number(request.adults),
            children: format.number(request.children),
          })}
        </Text>
        {quote.data.indicative ? (
          <Text className="font-body text-body-sm text-muted">
            {t('quotes.indicative', {
              price: format.money(quote.data.indicative.price),
              source: quote.data.indicative.source,
              date: format.date(quote.data.indicative.seenAt.slice(0, 10), 'medium'),
            })}
          </Text>
        ) : null}
        {quote.data.status === 'requested' ? (
          <>
            <Text className="font-body text-body-sm text-foreground">
              {t('quotes.answerBy', { time: format.dateTime(quote.data.answerBy) })}
            </Text>
            <View className="items-start">
              <Button
                testID="quote-withdraw"
                variant="ghost"
                loading={busy}
                onPress={() => void withdraw()}
              >
                {t('quotes.withdraw')}
              </Button>
            </View>
          </>
        ) : null}
        {closedKey ? (
          <Text testID="quote-closed" className="font-body text-body-sm text-foreground">
            {t(`quotes.closed.${closedKey as 'another'}`)}
          </Text>
        ) : null}
        <View className="items-start">
          <Button
            testID="quote-pdf"
            variant="ghost"
            loading={saving}
            onPress={() => void savePdf()}
          >
            {t('quotes.pdf')}
          </Button>
        </View>
        {bookingId ? (
          <View className="items-start">
            <Button
              testID="quote-booking"
              variant="secondary"
              onPress={() => router.push(`/trips/${bookingId}` as Href)}
            >
              {t('quotes.viewBooking')}
            </Button>
          </View>
        ) : null}
      </Card>

      {offer ? (
        <Card testID="quote-offer" className="gap-2 p-4">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('quotes.offer.heading')}
          </Text>
          <Text className="font-body-bold text-body text-foreground">{offer.details.title}</Text>
          <Text className="font-body text-body-sm text-foreground">{offer.details.summary}</Text>
          <Text className="font-body text-body-sm text-foreground">
            {offer.details.refundable
              ? t('quotes.offer.refundable')
              : t('quotes.offer.nonRefundable')}
          </Text>
          <View className="flex-row flex-wrap items-baseline justify-between gap-2">
            <Text className="font-body text-body text-foreground">{t('quotes.offer.total')}</Text>
            <Text testID="quote-total" className="font-heading text-h4 text-heading">
              {format.money(offer.total)}
            </Text>
          </View>
          <Text className="font-body text-body-sm text-muted">{t('quotes.offer.verified')}</Text>
          {quote.data.status === 'offered' ? (
            <>
              <Text className="font-body text-body-sm text-foreground">
                {t('quotes.offer.until', { time: format.dateTime(offer.expiresAt) })}
              </Text>
              <Text className="font-body text-body-sm text-foreground">
                {t('quotes.offer.afterPayment')}
              </Text>
              <Button
                testID="quote-book"
                onPress={() => router.push(`/checkout/${offer.quoteId}` as Href)}
              >
                {t('quotes.offer.book')}
              </Button>
            </>
          ) : null}
        </Card>
      ) : null}
    </ScrollView>
  );
}

/**
 * One price request (ADR-104): what was asked, where it stands, and the offer once a person
 * has verified the price. The offer is booked through the ordinary checkout; nothing here
 * books or pays.
 */
export function PriceRequestScreen() {
  const { t } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: t('quotes.heading') }} />
      <RequireAccount>
        <Request id={id} />
      </RequireAccount>
    </>
  );
}
