import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import {
  arrivingFlight,
  BOOKING_TERMS_VERSION,
  normalisePassport,
  normalisePhone,
  passengerDrafts,
  tripFacts,
  tripPartFacts,
  validateCheckout,
  type CheckoutIssue,
  type FieldIssues,
  type ItineraryFacts,
  type PassengerDraft,
  type TripComponent,
} from '@suskii/shared';
import { Button, Card, Input } from '@suskii/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { Checkbox } from '../components/booking/form-controls';
import { PassengerForm } from '../components/booking/passenger-form';
import { DateTimeField } from '../components/date-field';
import { Loading, Notice } from '../components/states';
import { useSensitiveScreen } from '../hooks/use-sensitive-screen';
import { isNetworkError, problemSlug } from '../lib/api';
import {
  arrivalDates,
  asIssue,
  checkAddonDetails,
  DETAIL_FIELDS,
  formPath,
  NO_DETAILS,
  normaliseFlightNumber,
  type AddonDetailsDraft,
  type DetailField,
} from '../lib/booking-form';
import { useApp, useT } from '../providers/app-provider';

type Trip = Schemas['Trip'];
type Quote = Schemas['Quote'];
type Prepared = NonNullable<Trip['prepared']>[number];

interface Ready {
  kind: 'ready';
  trip: Trip;
  prepared: Prepared[];
  quotes: Quote[];
  facts: ItineraryFacts;
}
type Loaded =
  Ready | { kind: 'nothing' } | { kind: 'expired'; part: TripComponent } | { kind: 'missing' };

interface Draft {
  passengers: PassengerDraft[];
  email: string;
  phone: string;
  terms: boolean;
}

/** The transfer details the trip's add-ons ask for, once (ADR-118). */
const detailFieldsOf = (quotes: readonly Quote[]): DetailField[] => [
  ...new Set(
    quotes.flatMap((quote) =>
      (quote.addon?.requiredDetails ?? []).flatMap((field) =>
        DETAIL_FIELDS[field] ? [DETAIL_FIELDS[field]] : [],
      ),
    ),
  ),
];

/** A transfer meets the flight the trip arrives on: start from it; the traveller can change it. */
function startingDetails(quotes: readonly Quote[]): AddonDetailsDraft {
  const flight = quotes.find((quote) => quote.flight)?.flight;
  const arriving = flight ? arrivingFlight(flight.offer) : null;
  return arriving ? { ...NO_DETAILS, ...arriving } : NO_DETAILS;
}

function TripDetailsForm({ trip, prepared, quotes, facts }: Ready) {
  const { api, locale } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => ({
    passengers: passengerDrafts(facts.counts),
    email: '',
    phone: '',
    terms: false,
  }));
  const [details, setDetails] = useState<AddonDetailsDraft>(() => startingDetails(quotes));
  const [errors, setErrors] = useState<FieldIssues>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per body: pressing again after a lost answer books nothing twice.
  const bookKey = useRef<{ body: string; key: string } | null>(null);

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

  const detailFields = useMemo(() => detailFieldsOf(quotes), [quotes]);
  // The arrival time falls on the transfer's own dates (ADR-114).
  const transfer = quotes.find((quote) =>
    quote.addon?.requiredDetails.includes('arrival_time'),
  )?.addon;
  const checked = useMemo(() => {
    const result = validateCheckout({ ...draft, guests: [] }, facts);
    return { ...result, errors: { ...result.errors, ...checkAddonDetails(detailFields, details) } };
  }, [draft, facts, detailFields, details]);
  const flightPrepared = quotes.some((quote) => quote.flight);
  // Abroad, every traveller gives a passport; on a domestic flight it is optional.
  const passport: 'required' | 'optional' | 'none' = facts.international
    ? 'required'
    : flightPrepared
      ? 'optional'
      : 'none';
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
      const body = {
        contact: { email: draft.email.trim(), phone: normalisePhone(draft.phone) },
        travellers: draft.passengers.map((passenger) => ({
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
        addonDetails:
          detailFields.length > 0
            ? {
                flightNumber: detailFields.includes('flightNumber')
                  ? normaliseFlightNumber(details.flightNumber)
                  : null,
                arrivalTime: detailFields.includes('arrivalTime')
                  ? details.arrivalTime.trim()
                  : null,
                pickupAddress: detailFields.includes('pickupAddress')
                  ? details.pickupAddress.trim()
                  : null,
              }
            : null,
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true as const,
        locale,
      };
      const serialised = JSON.stringify(body);
      if (bookKey.current?.body !== serialised)
        bookKey.current = { body: serialised, key: randomUUID() };
      const { data, error, response } = await api.POST('/v1/trips/{tripId}/book', {
        params: {
          path: { tripId: trip.id },
          header: { 'Idempotency-Key': bookKey.current.key },
        },
        body,
      });
      if (data) {
        // Every part is booked: the trip screen takes the one payment.
        queryClient.setQueryData(['built-trip', trip.id], { kind: 'ready', trip: data });
        router.dismissTo(`/trips/built/${trip.id}` as Href);
        return;
      }
      const slug = problemSlug(error);
      const problem = error as {
        part?: TripComponent;
        issues?: { index: number | null; path: string[]; code: string }[];
        missing?: string[];
      };
      const part = problem.part ? t(`trips.components.${problem.part}`) : '';
      if (slug === 'passengers-invalid' && problem.issues) {
        const mapped: FieldIssues = {};
        for (const item of problem.issues) {
          const key =
            item.index === null
              ? 'passengers'
              : formPath(`passengers.${item.index}.${item.path.join('.')}`);
          mapped[key] = asIssue(item.code);
        }
        setErrors(mapped);
        setFormError(t('trips.details.errors.part', { part }));
      } else if (slug === 'addon-details-invalid') {
        const mapped: FieldIssues = {};
        for (const field of problem.missing ?? []) {
          const key = DETAIL_FIELDS[field];
          if (key) mapped[`addonDetails.${key}`] = 'required';
        }
        setErrors(mapped);
        setFormError(t('trips.details.errors.part', { part }));
      } else if (slug === 'trip-travellers-short') {
        setFormError(t('trips.details.errors.short', { part }));
      } else if (slug === 'trip-nothing-prepared') {
        setFormError(t('trips.details.errors.nothing'));
      } else if (response.status === 410) {
        setFormError(t('trips.details.errors.expired', { part }));
      } else if (problem.part) {
        setFormError(t('trips.details.errors.part', { part }));
      } else setFormError(t('trips.details.errors.generic'));
    } catch {
      setFormError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const numbers = { adult: 0, child: 0, infant: 0 };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
    >
      <ScrollView
        testID="trip-details"
        className="flex-1 bg-background"
        contentContainerClassName="gap-4 p-4 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-2">
          <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
            {t('trips.details.heading')}
          </Text>
          <Text className="font-body text-body text-foreground">{t('trips.details.intro')}</Text>
        </View>

        <Card className="gap-2 p-4">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('trips.details.partsHeading')}
          </Text>
          {prepared.map((entry) => (
            <View
              key={entry.quoteId}
              testID={`trip-details-part-${entry.component}`}
              className="flex-row justify-between gap-4"
            >
              <View className="flex-1">
                <Text className="font-body text-body-sm text-foreground">
                  {t(`trips.components.${entry.component}`)}
                </Text>
                <Text className="font-body text-caption text-muted">{entry.title}</Text>
              </View>
              <Text className="font-body text-body-sm text-foreground">
                {format.money(entry.price)}
              </Text>
            </View>
          ))}
          <View className="flex-row justify-between gap-4 border-t border-border pt-2">
            <Text className="flex-1 font-body-bold text-body text-heading">
              {t('trips.page.totalWithPrepared')}
            </Text>
            <Text testID="trip-details-total" className="font-heading text-h4 text-heading">
              {format.money(trip.totalWithPrepared ?? trip.total)}
            </Text>
          </View>
          {flightPrepared ? (
            <Text testID="trip-details-bags" className="font-body text-caption text-foreground">
              {t('trips.details.bagsNote')}
            </Text>
          ) : null}
        </Card>

        <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
          {t('trips.details.travellersHeading')}
        </Text>
        {draft.passengers.map((passenger, index) => {
          numbers[passenger.type] += 1;
          return (
            <PassengerForm
              key={index}
              index={index}
              label={t(`checkout.traveller.${passenger.type}`, {
                number: numbers[passenger.type],
              })}
              passenger={passenger}
              onChange={(patch) => setPassenger(index, patch)}
              errors={errors}
              warnings={checked.warnings}
              passport={passport}
            />
          );
        })}

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
            {transfer && detailFields.includes('arrivalTime') ? (
              <DateTimeField
                testID="addonDetails.arrivalTime"
                label={t('checkout.addonDetails.arrivalTime')}
                value={details.arrivalTime}
                onChange={(arrivalTime) => setDetails((current) => ({ ...current, arrivalTime }))}
                {...arrivalDates(transfer)}
                opensOn={transfer.startDate}
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

        <Checkbox
          testID="accept-terms"
          label={t('checkout.terms')}
          checked={draft.terms}
          onChange={(terms) => setDraft((current) => ({ ...current, terms }))}
          error={issue('terms')}
        />
        {formError ? (
          <Text
            testID="trip-details-error"
            accessibilityRole="alert"
            className="font-body text-body-sm text-danger"
          >
            {formError}
            {errors.passengers ? ` ${t(`checkout.issues.${errors.passengers}`)}` : ''}
          </Text>
        ) : null}
        <Button testID="trip-details-submit" fullWidth loading={busy} onPress={() => void submit()}>
          {busy ? t('trips.details.booking') : t('trips.details.submit')}
        </Button>
        <Text className="font-body text-caption text-muted">{t('checkout.secure')}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function TripDetails({ tripId }: { tripId: string }) {
  const { api } = useApp();
  const { t } = useT();
  const router = useRouter();
  const query = useQuery({
    queryKey: ['trip-details', tripId],
    // The form starts from what was read once; a read in the background must not reset it.
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async (): Promise<Loaded> => {
      const { data: trip, response } = await api.GET('/v1/trips/{tripId}', {
        params: { path: { tripId } },
      });
      if (!trip) {
        if (response.status === 404 || response.status === 400) return { kind: 'missing' };
        throw new Error('trip unavailable');
      }
      const prepared = trip.prepared ?? [];
      if (prepared.length === 0) return { kind: 'nothing' };
      const answers = await Promise.all(
        prepared.map((part) =>
          api.GET('/v1/quotes/{quoteId}', { params: { path: { quoteId: part.quoteId } } }),
        ),
      );
      const quotes: Quote[] = [];
      for (const [index, part] of prepared.entries()) {
        const answer = answers[index];
        if (answer?.data) {
          quotes.push(answer.data);
          continue;
        }
        // A quote that has run out is chosen again from the trip screen.
        if (answer?.response.status === 404 || answer?.response.status === 410)
          return { kind: 'expired', part: part.component };
        throw new Error('quote unavailable');
      }
      const facts = tripFacts(quotes.map((quote) => tripPartFacts(quote)));
      if (!facts) throw new Error('no travellers');
      return { kind: 'ready', trip, prepared, quotes, facts };
    },
  });
  const back = () => router.dismissTo(`/trips/built/${tripId}` as Href);

  if (query.isPending) return <Loading label={t('common.loading')} />;
  if (!query.data)
    return (
      <Notice
        body={isNetworkError(query.error) ? t('mobile.networkError') : t('trips.page.loadError')}
        action={t('trips.page.retry')}
        onAction={() => void query.refetch()}
      />
    );
  switch (query.data.kind) {
    case 'ready':
      return <TripDetailsForm {...query.data} />;
    case 'missing':
      return <Notice testID="trip-details-missing" body={t('trips.page.missing')} />;
    case 'nothing':
      return (
        <Notice
          testID="trip-details-nothing"
          body={t('trips.details.nothing')}
          action={t('trips.details.back')}
          onAction={back}
        />
      );
    case 'expired':
      return (
        <Notice
          testID="trip-details-expired"
          body={t('trips.details.errors.expired', {
            part: t(`trips.components.${query.data.part}`),
          })}
          action={t('trips.details.back')}
          onAction={back}
        />
      );
  }
}

/**
 * One details form for a whole trip (ADR-118): the contact and every traveller once, for each
 * part Ask Suskii prepared. The API books each part as an ordinary booking with the travellers
 * its quote was priced for, all or nothing, and the trip screen then takes one payment. The
 * checks here mirror the API's (`validateCheckout` over the trip's facts); the API checks again.
 */
export function TripDetailsScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return (
    <RequireAccount>
      <TripDetails tripId={tripId} />
    </RequireAccount>
  );
}
