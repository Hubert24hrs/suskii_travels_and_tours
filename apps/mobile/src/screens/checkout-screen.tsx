import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import {
  BOOKING_TERMS_VERSION,
  FLIGHT_NUMBER_PATTERN,
  flightFacts,
  inhouseFacts,
  normalisePassport,
  normalisePhone,
  passengerDrafts,
  validateCheckout,
  type CheckoutDraft,
  type CheckoutIssue,
  type FieldIssues,
  type ItineraryFacts,
  type PassengerDraft,
} from '@suskii/shared';
import { Button, Card, Input, Modal } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { Checkbox } from '../components/booking/form-controls';
import { GuestForm, PassengerForm } from '../components/booking/passenger-form';
import {
  MethodChoice,
  PlanChoice,
  type PlanChoiceValue,
  type ProviderName,
} from '../components/booking/payment-options';
import { InhouseSummary } from '../components/inhouse/inhouse-summary';
import { Loading, Notice } from '../components/states';
import { useSensitiveScreen } from '../hooks/use-sensitive-screen';
import { problemSlug } from '../lib/api';
import { attestationHeader } from '../lib/attestation';
import { openHostedCheckout, startPayment } from '../lib/payment';
import { followBooking } from '../lib/push';
import { tripStore } from '../lib/trips';
import { useApp, useT } from '../providers/app-provider';

type Quote = Schemas['Quote'];

const ISSUE_CODES = new Set<string>([
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
  'nationality_mismatch',
]);

/** API field paths (`passengers.0.document.number`) to form paths (`passengers.0.passportNumber`). */
const formPath = (path: string): string =>
  path
    .replace(/^contact\./, '')
    .replace(/\.document\.number$/, '.passportNumber')
    .replace(/\.document\.expiryDate$/, '.passportExpiry')
    .replace(/\.document\.issuingCountry$/, '.issuingCountry')
    .replace(/\.document$/, '.passportNumber');

function draftFor(quote: Quote): CheckoutDraft {
  const counts =
    quote.flight?.offer.passengers ??
    (quote.package ?? quote.tour ?? quote.visa ?? quote.addon)?.travellers;
  // Visa assistance is for one nationality: every applicant starts with it (ADR-026).
  const passengers = counts ? passengerDrafts(counts, quote.visa?.nationality ?? '') : [];
  const guests = quote.hotel
    ? quote.hotel.request.rooms.map(() => ({ givenNames: '', surname: '' }))
    : [];
  return { passengers, guests, email: '', phone: '', terms: false };
}

/** Transfer details an add-on asks for (ADR-027); dates of birth come from the travellers. */
interface AddonDetailsDraft {
  flightNumber: string;
  arrivalTime: string;
  pickupAddress: string;
}
type DetailField = keyof AddonDetailsDraft;
const DETAIL_FIELDS: Record<string, DetailField> = {
  flight_number: 'flightNumber',
  arrival_time: 'arrivalTime',
  pickup_address: 'pickupAddress',
};
const normaliseFlightNumber = (value: string): string => value.trim().toUpperCase();

function checkAddonDetails(
  fields: readonly DetailField[],
  details: AddonDetailsDraft,
): FieldIssues {
  const issues: FieldIssues = {};
  for (const field of fields) {
    const value = details[field].trim();
    if (!value) issues[`addonDetails.${field}`] = 'required';
    else if (field === 'flightNumber' && !FLIGHT_NUMBER_PATTERN.test(normaliseFlightNumber(value)))
      issues[`addonDetails.${field}`] = 'invalid';
    else if (field === 'arrivalTime' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
      issues[`addonDetails.${field}`] = 'invalid';
    else if (field === 'pickupAddress' && value.length < 5)
      issues[`addonDetails.${field}`] = 'invalid';
  }
  return issues;
}

/** Whether travellers give passport details: required abroad, optional on domestic flights. */
function passportMode(
  quote: Quote,
  facts: ItineraryFacts | null,
): 'required' | 'optional' | 'none' {
  if (facts?.international) return 'required';
  return quote.flight ? 'optional' : 'none';
}

function Checkout({ quote }: { quote: Quote }) {
  const { api, user, locale } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const [draft, setDraft] = useState<CheckoutDraft>(() => draftFor(quote));
  const [errors, setErrors] = useState<FieldIssues>({});
  const [plan, setPlan] = useState<PlanChoiceValue>('full');
  const [provider, setProvider] = useState<ProviderName | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; headers: Record<string, string> } | null>(
    null,
  );
  const [priceChange, setPriceChange] = useState<Schemas['BookingPriceChange'] | null>(null);
  const [details, setDetails] = useState<AddonDetailsDraft>({
    flightNumber: '',
    arrivalTime: '',
    pickupAddress: '',
  });
  const detailFields = useMemo(
    () =>
      (quote.addon?.requiredDetails ?? []).flatMap((field) =>
        DETAIL_FIELDS[field] ? [DETAIL_FIELDS[field]] : [],
      ),
    [quote],
  );

  // Passport numbers are cleared when the app returns after a long time in the background.
  const clearPassports = useCallback(
    () =>
      setDraft((current) => ({
        ...current,
        passengers: current.passengers.map((passenger) => ({ ...passenger, passportNumber: '' })),
      })),
    [],
  );
  useSensitiveScreen(clearPassports);

  const facts = useMemo(
    () => (quote.flight ? flightFacts(quote.flight.offer) : inhouseFacts(quote)),
    [quote],
  );
  const checked = useMemo(() => {
    const result = validateCheckout(draft, facts, { nationality: quote.visa?.nationality });
    return { ...result, errors: { ...result.errors, ...checkAddonDetails(detailFields, details) } };
  }, [draft, facts, quote, detailFields, details]);
  const price = quote.flight?.offer.price ?? quote.hotel?.rate.price ?? quote.price;
  const inhouse = quote.price !== null;
  const issue = (key: string): string | undefined => {
    const code: CheckoutIssue | undefined = errors[key];
    return code ? t(`checkout.issues.${code}`) : undefined;
  };

  const setPassenger = (index: number, patch: Partial<PassengerDraft>) =>
    setDraft((current) => ({
      ...current,
      passengers: current.passengers.map((passenger, i) =>
        i === index ? { ...passenger, ...patch } : passenger,
      ),
    }));

  const pay = async (booking: { id: string; headers: Record<string, string> }) => {
    if (plan !== 'full') {
      const params = {
        path: { bookingId: booking.id },
        header: { ...booking.headers, 'Idempotency-Key': randomUUID() },
      };
      const result =
        plan === 'hold'
          ? await api.POST('/v1/bookings/{bookingId}/hold', { params })
          : await api.POST('/v1/bookings/{bookingId}/installment-plan', { params });
      if (!result.data) {
        const slug = problemSlug(result.error);
        setFormError(
          slug === 'hold-unavailable'
            ? t('checkout.errors.holdUnavailable')
            : slug === 'hold-limit'
              ? t('checkout.errors.holdLimit')
              : t('checkout.errors.generic'),
        );
        if (slug === 'hold-unavailable') setPlan('full');
        return;
      }
      router.replace(`/trips/${booking.id}` as Href);
      return;
    }
    const started = await startPayment(api, booking.id, booking.headers, { provider });
    switch (started.kind) {
      case 'redirect':
        await openHostedCheckout(started.checkoutUrl);
        router.replace(`/trips/${booking.id}` as Href);
        return;
      case 'paid':
        router.replace(`/trips/${booking.id}` as Href);
        return;
      case 'price-changed':
        setPriceChange(started.change);
        return;
      case 'expired':
        setFormError(t('checkout.expired.body'));
        return;
      case 'provider-unavailable':
        setProvider(null);
        setFormError(t('checkout.errors.providerUnavailable'));
        return;
      case 'device':
        setFormError(t('mobile.checkout.deviceCheckFailed'));
        return;
      case 'error':
        setFormError(t('checkout.errors.generic'));
    }
  };

  const submit = async () => {
    setFormError(null);
    if (Object.keys(checked.errors).length > 0) {
      setErrors(checked.errors);
      setFormError(t('checkout.issues.summary'));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (created) {
        await pay(created);
        return;
      }
      const guestProof = user ? null : await attestationHeader(api);
      const { data, error, response } = await api.POST('/v1/bookings', {
        params: {
          header: {
            'Idempotency-Key': randomUUID(),
            ...(guestProof ? { 'X-Suskii-Attestation': guestProof } : {}),
          },
        },
        body: {
          quoteId: quote.quoteId,
          contact: { email: draft.email.trim(), phone: normalisePhone(draft.phone) },
          ...(!quote.hotel
            ? {
                passengers: draft.passengers.map((passenger) => ({
                  type: passenger.type,
                  title: passenger.title as 'mr',
                  gender: passenger.gender as 'm',
                  givenNames: passenger.givenNames.trim(),
                  surname: passenger.surname.trim(),
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
              }
            : {
                guests: draft.guests.map((guest) => ({
                  givenNames: guest.givenNames.trim(),
                  surname: guest.surname.trim(),
                })),
              }),
          ...(quote.addon
            ? {
                addonDetails: {
                  flightNumber: detailFields.includes('flightNumber')
                    ? normaliseFlightNumber(details.flightNumber)
                    : null,
                  arrivalTime: detailFields.includes('arrivalTime')
                    ? details.arrivalTime.trim()
                    : null,
                  pickupAddress: detailFields.includes('pickupAddress')
                    ? details.pickupAddress.trim()
                    : null,
                },
              }
            : {}),
          termsVersion: BOOKING_TERMS_VERSION,
          acceptTerms: true,
          locale,
          turnstileToken: null,
        },
      });
      if (!data) {
        const slug = problemSlug(error);
        const problem = error as {
          issues?: { index: number | null; path: string[]; code: string }[];
          errors?: { path: string; message: string }[];
          missing?: string[];
        };
        const asIssue = (code: string): CheckoutIssue =>
          (ISSUE_CODES.has(code) ? code : 'invalid') as CheckoutIssue;
        if (slug === 'passengers-invalid' && problem.issues) {
          const mapped: FieldIssues = {};
          for (const item of problem.issues) {
            const key =
              item.index === null
                ? item.path[0] === 'guests'
                  ? 'guests'
                  : 'passengers'
                : formPath(`passengers.${item.index}.${item.path.join('.')}`);
            mapped[key] = asIssue(item.code);
          }
          setErrors(mapped);
          setFormError(t('checkout.issues.summary'));
        } else if (slug === 'validation-failed' && problem.errors) {
          const mapped: FieldIssues = {};
          for (const item of problem.errors) mapped[formPath(item.path)] = asIssue(item.message);
          setErrors(mapped);
          setFormError(t('checkout.issues.summary'));
        } else if (slug === 'addon-details-invalid') {
          const mapped: FieldIssues = {};
          for (const field of problem.missing ?? []) {
            const key = DETAIL_FIELDS[field];
            if (key) mapped[`addonDetails.${key}`] = 'required';
          }
          setErrors(mapped);
          setFormError(t('checkout.issues.summary'));
        } else if (slug === 'sold-out') {
          setFormError(t('checkout.errors.soldOut'));
        } else if (slug === 'terms-outdated') {
          setFormError(t('checkout.errors.terms'));
        } else if (slug === 'bot-check-failed') {
          setFormError(t('mobile.checkout.deviceCheckFailed'));
        } else if (response.status === 410) {
          setFormError(t('checkout.expired.body'));
        } else {
          setFormError(t('checkout.errors.generic'));
        }
        return;
      }
      const booking = data.booking;
      const headers: Record<string, string> = data.accessToken
        ? { 'X-Booking-Token': data.accessToken }
        : {};
      if (data.accessToken) await tripStore.addGuestTrip(booking.id, data.accessToken);
      tripStore.saveBooking(booking);
      setCreated({ id: booking.id, headers });
      // The permission prompt comes with the booking, never on first launch (ADR-022).
      void followBooking(api, booking.id, headers, true);
      await pay({ id: booking.id, headers });
    } catch {
      setFormError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const acceptPrice = async () => {
    if (!created || !priceChange) return;
    setBusy(true);
    const { data } = await api.POST('/v1/bookings/{bookingId}/price-consent', {
      params: { path: { bookingId: created.id }, header: created.headers },
      body: { total: priceChange.current },
    });
    setPriceChange(null);
    if (data) await pay(created);
    else setFormError(t('checkout.errors.generic'));
    setBusy(false);
  };

  const submitLabel =
    plan === 'hold'
      ? t('checkout.plan.reserve')
      : plan === 'installments'
        ? t('checkout.plan.setUp')
        : t('checkout.pay');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
    >
      <ScrollView
        testID="checkout"
        className="flex-1 bg-background"
        contentContainerClassName="gap-4 p-4 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        <Card className="gap-2 p-4">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {quote.hotel ? t('checkout.stay') : t('checkout.trip')}
          </Text>
          {inhouse ? <InhouseSummary items={quote} /> : null}
          {quote.flight
            ? quote.flight.offer.slices.map((slice, index) => (
                <Text key={index} className="font-body text-body-sm text-foreground">
                  {format.date(slice.departureLocal.slice(0, 10), 'weekday')} ·{' '}
                  {slice.departureLocal.slice(11, 16)} {slice.origin.code} →{' '}
                  {slice.arrivalLocal.slice(11, 16)} {slice.destination.code}
                </Text>
              ))
            : null}
          {quote.hotel ? (
            <Text className="font-body text-body-sm text-foreground">
              {quote.hotel.name} · {quote.hotel.rate.roomName} ·{' '}
              {t('booking.nights', { count: quote.hotel.nights })}
            </Text>
          ) : null}
        </Card>

        {draft.passengers.map((passenger, index) => {
          const number = draft.passengers
            .slice(0, index + 1)
            .filter((item) => item.type === passenger.type).length;
          return (
            <PassengerForm
              key={index}
              index={index}
              label={t(`checkout.traveller.${passenger.type}`, { number })}
              passenger={passenger}
              onChange={(patch) => setPassenger(index, patch)}
              errors={errors}
              warnings={checked.warnings}
              passport={passportMode(quote, facts)}
            />
          );
        })}
        {quote.visa && draft.passengers.length > 0 ? (
          <Text className="font-body text-body-sm text-foreground">
            {t('checkout.visaNationality', { country: format.country(quote.visa.nationality) })}
          </Text>
        ) : null}
        {detailFields.length > 0 ? (
          <Card className="gap-3 p-4">
            <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
              {t('checkout.addonDetails.heading')}
            </Text>
            <Text className="font-body text-body-sm text-muted">
              {t('checkout.addonDetails.hint')}
            </Text>
            {detailFields.includes('flightNumber') ? (
              <Input
                testID="addonDetails.flightNumber"
                label={t('checkout.addonDetails.flightNumber')}
                hint={t('checkout.addonDetails.flightNumberHint')}
                value={details.flightNumber}
                onChangeText={(flightNumber) =>
                  setDetails((current) => ({ ...current, flightNumber }))
                }
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={8}
                error={
                  errors['addonDetails.flightNumber'] === 'invalid'
                    ? t('checkout.addonDetails.invalidFlightNumber')
                    : issue('addonDetails.flightNumber')
                }
              />
            ) : null}
            {detailFields.includes('arrivalTime') ? (
              <Input
                testID="addonDetails.arrivalTime"
                label={t('checkout.addonDetails.arrivalTime')}
                hint={t('mobile.checkout.dateTimeHint')}
                value={details.arrivalTime}
                onChangeText={(arrivalTime) =>
                  setDetails((current) => ({ ...current, arrivalTime }))
                }
                keyboardType="numbers-and-punctuation"
                maxLength={16}
                error={issue('addonDetails.arrivalTime')}
              />
            ) : null}
            {detailFields.includes('pickupAddress') ? (
              <Input
                testID="addonDetails.pickupAddress"
                label={t('checkout.addonDetails.pickupAddress')}
                value={details.pickupAddress}
                onChangeText={(pickupAddress) =>
                  setDetails((current) => ({ ...current, pickupAddress }))
                }
                autoComplete="street-address"
                maxLength={300}
                error={issue('addonDetails.pickupAddress')}
              />
            ) : null}
          </Card>
        ) : null}
        {draft.guests.map((guest, index) => (
          <GuestForm
            key={index}
            index={index}
            guest={guest}
            errors={errors}
            onChange={(patch) =>
              setDraft((current) => ({
                ...current,
                guests: current.guests.map((item, i) =>
                  i === index ? { ...item, ...patch } : item,
                ),
              }))
            }
          />
        ))}

        <Card className="gap-3 p-4">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('checkout.contact')}
          </Text>
          <Text className="font-body text-body-sm text-muted">{t('checkout.contactHint')}</Text>
          <Input
            testID="contact-email"
            label={t('checkout.fields.email')}
            value={draft.email}
            onChangeText={(email) => setDraft((current) => ({ ...current, email }))}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={issue('email')}
          />
          <Input
            testID="contact-phone"
            label={t('checkout.fields.phone')}
            hint={t('checkout.fields.phoneHint')}
            value={draft.phone}
            onChangeText={(phone) => setDraft((current) => ({ ...current, phone }))}
            keyboardType="phone-pad"
            autoComplete="tel"
            error={issue('phone')}
          />
        </Card>

        <PlanChoice
          vertical={quote.vertical}
          options={quote.payment}
          value={plan}
          onChange={setPlan}
          extrasSelected={false}
        />
        <MethodChoice providers={quote.payment.providers} value={provider} onChange={setProvider} />

        {price ? (
          <Card className="gap-2 p-4">
            <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
              {t('checkout.summary')}
            </Text>
            <View className="flex-row justify-between">
              <Text className="font-body text-body-sm text-foreground">
                {inhouse ? t('checkout.basePrice') : t('checkout.fare')}
              </Text>
              <Text className="font-body text-body-sm text-foreground">
                {format.money(price.fare)}
              </Text>
            </View>
            {inhouse && price.taxes.amountMinor === 0 ? null : (
              <View className="flex-row justify-between">
                <Text className="font-body text-body-sm text-foreground">
                  {t('checkout.taxes')}
                </Text>
                <Text className="font-body text-body-sm text-foreground">
                  {format.money(price.taxes)}
                </Text>
              </View>
            )}
            {price.fees.map((fee) => (
              <View key={fee.code} className="flex-row justify-between">
                <Text className="font-body text-body-sm text-foreground">{fee.label}</Text>
                <Text className="font-body text-body-sm text-foreground">
                  {format.money(fee.amount)}
                </Text>
              </View>
            ))}
            <View className="flex-row justify-between border-t border-border pt-2">
              <Text className="font-body-bold text-body text-heading">{t('checkout.total')}</Text>
              <Text testID="checkout-total" className="font-heading text-h4 text-heading">
                {format.money(price.total)}
              </Text>
            </View>
            <Text className="font-body text-caption text-muted">{t('checkout.totalNote')}</Text>
          </Card>
        ) : null}

        <Checkbox
          testID="accept-terms"
          label={t('checkout.terms')}
          checked={draft.terms}
          onChange={(terms) => setDraft((current) => ({ ...current, terms }))}
          error={issue('terms')}
        />
        {formError ? (
          <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
            {formError}
          </Text>
        ) : null}
        <Text className="font-body text-caption text-muted">
          {t('mobile.checkout.payOnProvider')}
        </Text>
        <Button testID="checkout-submit" fullWidth loading={busy} onPress={() => void submit()}>
          {busy ? t('checkout.paying') : submitLabel}
        </Button>
        {created ? (
          <Button variant="ghost" onPress={() => router.replace(`/trips/${created.id}` as Href)}>
            {t('mobile.checkout.viewBooking')}
          </Button>
        ) : null}
      </ScrollView>
      <Modal
        open={priceChange !== null}
        onOpenChange={(open) => {
          if (!open) setPriceChange(null);
        }}
        title={t('checkout.priceChange.title')}
        description={t('checkout.priceChange.body')}
        closeLabel={t('common.close')}
        footer={
          <View className="gap-2">
            <Button fullWidth loading={busy} onPress={() => void acceptPrice()}>
              {t('checkout.priceChange.accept')}
            </Button>
            <Button variant="ghost" onPress={() => setPriceChange(null)}>
              {t('checkout.priceChange.decline')}
            </Button>
          </View>
        }
      >
        {priceChange ? (
          <View className="gap-2">
            <Text className="font-body text-body text-foreground">
              {t('checkout.priceChange.previous')}: {format.money(priceChange.previous)}
            </Text>
            <Text testID="new-total" className="font-body-bold text-body text-heading">
              {t('checkout.priceChange.current')}: {format.money(priceChange.current)}
            </Text>
          </View>
        ) : null}
      </Modal>
    </KeyboardAvoidingView>
  );
}

/** Checkout (ADR-020, ADR-021): travellers, contact, how to pay, then the hosted payment page. */
export function CheckoutScreen() {
  const { quoteId } = useLocalSearchParams<{ quoteId: string }>();
  const { api } = useApp();
  const { t } = useT();
  const router = useRouter();
  const quote = useQuery({
    queryKey: ['quote', quoteId],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, response } = await api.GET('/v1/quotes/{quoteId}', {
        params: { path: { quoteId } },
      });
      if (!data) throw new Error(String(response.status));
      return data;
    },
  });
  if (quote.isPending) return <Loading label={t('checkout.loadingQuote')} />;
  if (!quote.data) {
    return (
      <Notice
        title={t('checkout.expired.heading')}
        body={t('checkout.expired.body')}
        action={t('checkout.expired.cta')}
        onAction={() => router.back()}
      />
    );
  }
  return <Checkout quote={quote.data} />;
}
