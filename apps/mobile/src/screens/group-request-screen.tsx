import { useFormatters } from '@suskii/i18n/react';
import {
  CABIN_CLASSES,
  GROUP_MAX_TRAVELLERS,
  GROUP_MIN_TRAVELLERS,
  GROUP_NOTES_MAX,
  GROUP_ORGANISATION_MAX,
  groupRequestSchema,
  type CabinClass,
  type GroupTripType,
} from '@suskii/shared';
import { Button, Card, DateRangePicker, Input, SegmentedControl } from '@suskii/ui-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import { PlaceField, type PlaceOption } from '../components/search/place-field';
import { problemSlug } from '../lib/api';
import { attestationHeader } from '../lib/attestation';
import { fromIso, toIso } from '../lib/dates';
import { toFieldErrors, type FieldErrors } from '../lib/form-issues';
import { supportTokens } from '../lib/support';
import { useApp, useT } from '../providers/app-provider';
import { useAuth } from '../providers/auth';

const TEXT_AREA =
  'min-h-28 rounded-md border border-border-strong bg-surface px-4 py-3 font-body text-body text-foreground';

/**
 * A flight for ten travellers or more (ADR-093). Airlines price groups through their group
 * desks, so this is a request the team answers, not a search: it starts a support conversation
 * and opens it. Guests prove the app is genuine and give an email, as on the support screen.
 */
export function GroupRequestScreen() {
  const { api } = useApp();
  const { user } = useAuth();
  const { t, locale } = useT();
  const format = useFormatters();
  const router = useRouter();
  const [tripType, setTripType] = useState<GroupTripType>('round_trip');
  const [origin, setOrigin] = useState<PlaceOption | null>(null);
  const [destination, setDestination] = useState<PlaceOption | null>(null);
  const [departureDate, setDepartureDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [travellers, setTravellers] = useState('');
  const [cabinClass, setCabinClass] = useState<CabinClass>('economy');
  const [organisation, setOrganisation] = useState('');
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roundTrip = tripType === 'round_trip';

  const submit = async () => {
    setFormError(null);
    const input = {
      tripType,
      origin: origin?.code ?? '',
      destination: destination?.code ?? '',
      departureDate,
      returnDate: roundTrip && returnDate !== '' ? returnDate : null,
      // The schema takes a whole number; anything else is reported on the field.
      travellers: /^\d+$/.test(travellers.trim()) ? Number(travellers) : null,
      cabinClass,
      organisation,
      notes,
      email: user || email.trim() === '' ? null : email.trim(),
    };
    const result = groupRequestSchema.safeParse(input);
    const found = result.success ? {} : toFieldErrors(result.error.issues, input, t);
    if (found.travellers)
      found.travellers = t('groups.errors.travellers', {
        min: GROUP_MIN_TRAVELLERS,
        max: GROUP_MAX_TRAVELLERS,
      });
    if (!user && input.email === null) found.email = t('search.issues.required');
    setErrors(found);
    if (!result.success || Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const proof = user ? null : await attestationHeader(api);
      const { data, error: problem } = await api.POST('/v1/flights/group-requests', {
        params: { header: proof ? { 'X-Suskii-Attestation': proof } : {} },
        body: { ...result.data, turnstileToken: null },
      });
      if (data) {
        if (data.accessToken) await supportTokens.save(data.conversation.id, data.accessToken);
        router.replace(`/support/${data.conversation.id}` as Href);
        return;
      }
      setFormError(
        problemSlug(problem) === 'support-limit'
          ? t('support.errors.limit')
          : t('support.errors.generic'),
      );
    } catch {
      setFormError(t('support.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentContainerClassName="gap-4 p-4"
      keyboardShouldPersistTaps="handled"
      testID="group-request-screen"
    >
      <Stack.Screen options={{ title: t('groups.title') }} />
      <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
        {t('groups.heading')}
      </Text>
      <Text className="font-body text-body text-foreground">{t('groups.body')}</Text>
      <Card className="gap-4 p-4">
        <SegmentedControl<GroupTripType>
          label={t('groups.tripType')}
          options={[
            { value: 'round_trip', label: t('groups.roundTrip') },
            { value: 'one_way', label: t('groups.oneWay') },
          ]}
          value={tripType}
          onValueChange={setTripType}
        />
        <PlaceField
          testID="group-from"
          label={t('groups.from')}
          value={origin}
          onChange={setOrigin}
          error={errors.origin}
        />
        <PlaceField
          testID="group-to"
          label={t('groups.to')}
          value={destination}
          onChange={setDestination}
          error={errors.destination}
        />
        <DateRangePicker
          testID="group-dates"
          mode={roundTrip ? 'range' : 'single'}
          label={roundTrip ? t('search.flights.dates') : t('groups.departure')}
          value={{ from: fromIso(departureDate), to: fromIso(returnDate) }}
          onChange={(range) => {
            setDepartureDate(range.from ? toIso(range.from) : '');
            setReturnDate(range.to ? toIso(range.to) : '');
          }}
          formatValue={(range) => {
            if (!range.from) return undefined;
            const from = toIso(range.from);
            return roundTrip && range.to
              ? format.dateRange(from, toIso(range.to), 'weekday')
              : format.date(from, 'weekday');
          }}
          placeholder={
            roundTrip ? t('search.flights.datesPlaceholder') : t('search.flights.datePlaceholder')
          }
          locale={locale}
          labels={{ done: t('search.datePicker.done'), close: t('search.datePicker.close') }}
        />
        {errors.departureDate || errors.returnDate ? (
          <Text accessibilityLiveRegion="polite" className="font-body text-caption text-danger">
            {errors.departureDate ?? errors.returnDate}
          </Text>
        ) : null}
        <Input
          testID="group-travellers"
          label={t('groups.travellers')}
          hint={t('groups.travellersHint', {
            min: GROUP_MIN_TRAVELLERS,
            max: GROUP_MAX_TRAVELLERS,
          })}
          value={travellers}
          onChangeText={setTravellers}
          keyboardType="number-pad"
          maxLength={3}
          error={errors.travellers}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <SegmentedControl
            label={t('groups.cabin')}
            options={CABIN_CLASSES.map((cabin: CabinClass) => ({
              value: cabin,
              label: t(`cabins.${cabin}`),
            }))}
            value={cabinClass}
            onValueChange={setCabinClass}
          />
        </ScrollView>
        <Input
          testID="group-organisation"
          label={t('groups.organisation')}
          value={organisation}
          onChangeText={setOrganisation}
          maxLength={GROUP_ORGANISATION_MAX}
          autoComplete="organization"
          error={errors.organisation}
        />
        <View className="gap-1">
          <Text className="font-body-medium text-body-sm text-foreground">{t('groups.notes')}</Text>
          <TextInput
            testID="group-notes"
            accessibilityLabel={t('groups.notes')}
            multiline
            textAlignVertical="top"
            value={notes}
            maxLength={GROUP_NOTES_MAX}
            onChangeText={setNotes}
            className={TEXT_AREA}
          />
          <Text className="font-body text-body-sm text-muted">{t('groups.notesHint')}</Text>
        </View>
        {user ? null : (
          <Input
            testID="group-email"
            label={t('groups.email')}
            hint={t('groups.emailHint')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={errors.email}
          />
        )}
        {formError ? (
          <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
            {formError}
          </Text>
        ) : null}
        <Button testID="group-submit" loading={busy} onPress={() => void submit()}>
          {t('groups.submit')}
        </Button>
      </Card>
    </ScrollView>
  );
}
