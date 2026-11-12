import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card, Input } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { ChoiceChips } from '../components/booking/form-controls';
import { Loading, Notice } from '../components/states';
import { problemSlug } from '../lib/api';
import { ISO_DAY, kilometres } from '../lib/cars';
import { pickDocument } from '../lib/visa-upload';
import { useApp, useT } from '../providers/app-provider';

type Profile = Schemas['DriverProfile'];
type Place = Schemas['RidePlaces']['places'][number];
type DriverRide = Schemas['DriverRide'];

const DOCUMENT_KINDS = [
  'licence',
  'vehicle_registration',
  'insurance',
  'roadworthiness',
  'selfie',
] as const;
const CATEGORIES = ['standard', 'comfort', 'xl'] as const;
// `other` (and anything new) reads as the generic reason; a key named `other` would be a plural.
const REASONS = [
  'documents_unclear',
  'documents_expired',
  'identity_mismatch',
  'licence_invalid',
  'vehicle_unsuitable',
  'rating_below_minimum',
  'safety_concern',
  'fraud',
] as const;
const reasonKey = (reason: string): (typeof REASONS)[number] | 'generic' =>
  REASONS.find((known) => known === reason) ?? 'generic';

function Alert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
      {message}
    </Text>
  );
}

function usePlaces() {
  const { api } = useApp();
  return useQuery({
    queryKey: ['ride-places'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Place[]> => {
      const { data, response } = await api.GET('/v1/rides/places');
      if (!data) throw new Error(String(response.status));
      return data.places;
    },
  });
}

/** The application (ADR-050): identity and licence numbers go to the KYC check, encrypted. */
function DriverApply({ onApplied }: { onApplied: () => Promise<unknown> }) {
  const { api } = useApp();
  const { t } = useT();
  const places = usePlaces();
  const [form, setForm] = useState({
    givenNames: '',
    surname: '',
    dateOfBirth: '',
    cityName: '',
    nin: '',
    licenceNumber: '',
    licenceExpiresOn: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cities = [...new Set((places.data ?? []).map((place) => place.cityName))].sort();
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  const submit = async () => {
    setError(null);
    const complete =
      form.givenNames.trim() &&
      form.surname.trim() &&
      form.cityName &&
      /^\d{11}$/.test(form.nin) &&
      form.licenceNumber.trim() &&
      ISO_DAY.test(form.dateOfBirth) &&
      ISO_DAY.test(form.licenceExpiresOn);
    if (!complete) {
      setError(t('mobile.cars.driver.applyErrors.invalid'));
      return;
    }
    setBusy(true);
    try {
      const { data, error: problem } = await api.POST('/v1/drivers/applications', {
        body: {
          ...form,
          givenNames: form.givenNames.trim(),
          surname: form.surname.trim(),
          licenceNumber: form.licenceNumber.trim().toUpperCase(),
        },
      });
      if (data) {
        await onApplied();
        return;
      }
      const slug = problemSlug(problem);
      setError(
        slug === 'driver-exists'
          ? t('mobile.cars.driver.applyErrors.exists')
          : slug === 'driver-too-young'
            ? t('mobile.cars.driver.applyErrors.tooYoung')
            : slug === 'licence-expiring'
              ? t('mobile.cars.driver.applyErrors.licenceExpiring')
              : slug === 'validation-failed'
                ? t('mobile.cars.driver.applyErrors.invalid')
                : t('mobile.cars.driver.applyErrors.generic'),
      );
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="driver-apply" className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('mobile.cars.driver.applyHeading')}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {t('mobile.cars.driver.applyIntro')}
      </Text>
      <Input
        testID="driver.givenNames"
        label={t('mobile.cars.driver.givenNames')}
        value={form.givenNames}
        onChangeText={(givenNames) => set({ givenNames })}
        autoCapitalize="words"
        autoComplete="name-given"
      />
      <Input
        testID="driver.surname"
        label={t('mobile.cars.driver.surname')}
        value={form.surname}
        onChangeText={(surname) => set({ surname })}
        autoCapitalize="words"
        autoComplete="name-family"
      />
      <Input
        testID="driver.dateOfBirth"
        label={t('mobile.cars.driver.dateOfBirth')}
        hint={t('mobile.checkout.dateHint')}
        value={form.dateOfBirth}
        onChangeText={(dateOfBirth) => set({ dateOfBirth })}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      {cities.length > 0 ? (
        <ChoiceChips
          testID="driver.cityName"
          label={t('mobile.cars.driver.city')}
          options={cities.map((name) => ({ value: name, label: name }))}
          value={form.cityName}
          onChange={(cityName) => set({ cityName })}
        />
      ) : null}
      <Input
        testID="driver.nin"
        label={t('mobile.cars.driver.nin')}
        hint={t('mobile.cars.driver.ninHint')}
        value={form.nin}
        onChangeText={(nin) => set({ nin: nin.replace(/\D/g, '') })}
        keyboardType="number-pad"
        maxLength={11}
        autoComplete="off"
        secureTextEntry
      />
      <Input
        testID="driver.licenceNumber"
        label={t('mobile.cars.driver.licenceNumber')}
        value={form.licenceNumber}
        onChangeText={(licenceNumber) => set({ licenceNumber })}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        maxLength={30}
      />
      <Input
        testID="driver.licenceExpiresOn"
        label={t('mobile.cars.driver.licenceExpiresOn')}
        hint={t('mobile.cars.dateHint')}
        value={form.licenceExpiresOn}
        onChangeText={(licenceExpiresOn) => set({ licenceExpiresOn })}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      <Alert message={error} />
      <Button testID="driver-apply-submit" fullWidth loading={busy} onPress={() => void submit()}>
        {t('mobile.cars.driver.submitApplication')}
      </Button>
    </Card>
  );
}

function AddVehicle({ onAdded }: { onAdded: () => Promise<unknown> }) {
  const { api } = useApp();
  const { t } = useT();
  const [form, setForm] = useState({
    make: '',
    model: '',
    year: '',
    colour: '',
    plate: '',
    category: 'standard' as (typeof CATEGORIES)[number],
    seats: '4',
    insuranceExpiresOn: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  const submit = async () => {
    setError(null);
    const year = Number(form.year);
    const seats = Number(form.seats);
    if (
      !form.make.trim() ||
      !form.model.trim() ||
      !form.colour.trim() ||
      !form.plate.trim() ||
      !Number.isInteger(year) ||
      !Number.isInteger(seats) ||
      !ISO_DAY.test(form.insuranceExpiresOn)
    ) {
      setError(t('mobile.cars.driver.vehicleErrors.invalid'));
      return;
    }
    setBusy(true);
    try {
      const { data, error: problem } = await api.POST('/v1/drivers/me/vehicles', {
        body: {
          make: form.make.trim(),
          model: form.model.trim(),
          year,
          colour: form.colour.trim(),
          plate: form.plate.trim().toUpperCase(),
          category: form.category,
          seats,
          insuranceExpiresOn: form.insuranceExpiresOn,
        },
      });
      if (data) {
        await onAdded();
        return;
      }
      const slug = problemSlug(problem);
      setError(
        slug === 'plate-taken'
          ? t('mobile.cars.driver.vehicleErrors.plate')
          : slug === 'insurance-expired'
            ? t('mobile.cars.driver.vehicleErrors.insurance')
            : slug === 'validation-failed'
              ? t('mobile.cars.driver.vehicleErrors.invalid')
              : t('mobile.cars.driver.vehicleErrors.generic'),
      );
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="driver-add-vehicle" className="gap-3">
      <Input
        testID="vehicle.make"
        label={t('mobile.cars.driver.make')}
        value={form.make}
        onChangeText={(make) => set({ make })}
      />
      <Input
        testID="vehicle.model"
        label={t('mobile.cars.driver.model')}
        value={form.model}
        onChangeText={(model) => set({ model })}
      />
      <Input
        testID="vehicle.year"
        label={t('mobile.cars.driver.year')}
        value={form.year}
        onChangeText={(year) => set({ year: year.replace(/\D/g, '') })}
        keyboardType="number-pad"
        maxLength={4}
      />
      <Input
        testID="vehicle.colour"
        label={t('mobile.cars.driver.colour')}
        value={form.colour}
        onChangeText={(colour) => set({ colour })}
      />
      <Input
        testID="vehicle.plate"
        label={t('mobile.cars.driver.plate')}
        value={form.plate}
        onChangeText={(plate) => set({ plate })}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={12}
      />
      <ChoiceChips
        testID="vehicle.category"
        label={t('mobile.cars.driver.category')}
        options={CATEGORIES.map((value) => ({
          value,
          label: t(`cars.rides.categories.${value}`),
        }))}
        value={form.category}
        onChange={(category) => set({ category })}
      />
      <Input
        testID="vehicle.seats"
        label={t('mobile.cars.driver.seats')}
        value={form.seats}
        onChangeText={(seats) => set({ seats: seats.replace(/\D/g, '') })}
        keyboardType="number-pad"
        maxLength={1}
      />
      <Input
        testID="vehicle.insuranceExpiresOn"
        label={t('mobile.cars.driver.insuranceExpiresOn')}
        hint={t('mobile.cars.dateHint')}
        value={form.insuranceExpiresOn}
        onChangeText={(insuranceExpiresOn) => set({ insuranceExpiresOn })}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      <Alert message={error} />
      <Button testID="vehicle-add" variant="secondary" loading={busy} onPress={() => void submit()}>
        {t('mobile.cars.driver.addVehicle')}
      </Button>
    </View>
  );
}

/** Where an application stands: checks, documents (uploaded here) and vehicles. */
function DriverProgress({ profile, reload }: { profile: Profile; reload: () => Promise<unknown> }) {
  const { api } = useApp();
  const { t } = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (kind: (typeof DOCUMENT_KINDS)[number]) => {
    setError(null);
    let picked: Awaited<ReturnType<typeof pickDocument>>;
    try {
      picked = await pickDocument();
    } catch {
      setError(t('mobile.visa.pickerFailed'));
      return;
    }
    if (picked === 'cancelled') return;
    if (picked === 'unsupported') {
      setError(t('mobile.cars.driver.uploadErrors.type'));
      return;
    }
    setBusy(kind);
    try {
      const { data, response } = await api.PUT('/v1/drivers/me/documents/{kind}', {
        params: { path: { kind } },
        // The raw bytes are the body (no JSON); the declared type only picks the parser.
        body: picked.bytes as unknown as string,
        bodySerializer: (body) => body,
        headers: { 'Content-Type': picked.type },
      });
      if (data) await reload();
      else
        setError(
          response.status === 413
            ? t('mobile.cars.driver.uploadErrors.size')
            : response.status === 415
              ? t('mobile.cars.driver.uploadErrors.type')
              : t('mobile.cars.driver.uploadErrors.generic'),
        );
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(null);
    }
  };

  const activate = async (vehicleId: string) => {
    setError(null);
    setBusy(vehicleId);
    try {
      const { data } = await api.POST('/v1/drivers/me/vehicles/{vehicleId}/activate', {
        params: { path: { vehicleId } },
      });
      if (data) await reload();
      else setError(t('mobile.cars.driver.actionError'));
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(null);
    }
  };

  const editable = profile.status !== 'rejected';
  return (
    <>
      <Card testID="driver-progress" className="gap-3 p-4">
        <View className="items-start gap-2">
          <Badge
            variant={
              profile.status === 'approved'
                ? 'success'
                : profile.status === 'pending'
                  ? 'info'
                  : 'danger'
            }
          >
            {t(`mobile.cars.driver.status.${profile.status}`)}
          </Badge>
          {profile.statusReason ? (
            <Text className="font-body text-body-sm text-foreground">
              {t('mobile.cars.driver.statusReason', {
                reason: t(`mobile.cars.driver.reasons.${reasonKey(profile.statusReason)}`),
              })}
            </Text>
          ) : null}
        </View>
        {profile.missing.length > 0 ? (
          <View className="gap-1">
            <Text className="font-body-bold text-body-sm text-foreground">
              {t('mobile.cars.driver.missingHeading')}
            </Text>
            {profile.missing.map((step) => (
              <Text key={step} className="font-body text-body-sm text-foreground">
                • {t(`mobile.cars.driver.missing.${step}`)}
              </Text>
            ))}
          </View>
        ) : null}
      </Card>
      <Card className="gap-3 p-4">
        <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
          {t('mobile.cars.driver.documentsHeading')}
        </Text>
        {DOCUMENT_KINDS.map((kind) => {
          const document = profile.documents.find((item) => item.kind === kind);
          const label = t(`mobile.cars.driver.documentKinds.${kind}`);
          return (
            <View key={kind} className="gap-1">
              <Text className="font-body-bold text-body-sm text-foreground">{label}</Text>
              <Text testID={`document-${kind}`} className="font-body text-caption text-muted">
                {t(`mobile.cars.driver.documentStatuses.${document?.status ?? 'missing'}`)}
              </Text>
              {editable && document?.status !== 'approved' && document?.status !== 'clean' ? (
                <Button
                  testID={`upload-${kind}`}
                  variant="ghost"
                  loading={busy === kind}
                  onPress={() => void upload(kind)}
                >
                  {t('mobile.cars.driver.upload', { kind: label })}
                </Button>
              ) : null}
            </View>
          );
        })}
      </Card>
      <Card className="gap-3 p-4">
        <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
          {t('mobile.cars.driver.vehicleHeading')}
        </Text>
        {profile.vehicles.map((vehicle) => (
          <View key={vehicle.id} className="gap-1">
            <Text className="font-body text-body-sm text-foreground">
              {t('mobile.cars.driver.vehicleSummary', {
                colour: vehicle.colour,
                make: vehicle.make,
                model: vehicle.model,
                year: String(vehicle.year),
                plate: vehicle.plate,
              })}
            </Text>
            <Text className="font-body text-caption text-muted">
              {t(`mobile.cars.driver.vehicleStatuses.${vehicle.status}`)}
            </Text>
            {vehicle.status === 'approved' && !vehicle.active ? (
              <Button
                variant="ghost"
                loading={busy === vehicle.id}
                onPress={() => void activate(vehicle.id)}
              >
                {t('mobile.cars.driver.useVehicle')}
              </Button>
            ) : null}
          </View>
        ))}
        {editable && profile.vehicles.length < 3 ? <AddVehicle onAdded={reload} /> : null}
      </Card>
      <Alert message={error} />
    </>
  );
}

function CurrentRide({ ride, reload }: { ride: DriverRide; reload: () => Promise<unknown> }) {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = { params: { path: { rideId: ride.id } } };

  const act = async (run: () => Promise<{ ok: boolean; slug: string | null }>) => {
    setBusy(true);
    setError(null);
    try {
      const { ok, slug } = await run();
      if (!ok)
        setError(
          slug === 'pin-invalid'
            ? t('mobile.cars.driver.pinWrong')
            : slug === 'pin-locked'
              ? t('mobile.cars.driver.pinLocked')
              : t('mobile.cars.driver.actionError'),
        );
      await reload();
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };
  const outcome = (result: { data?: unknown; error?: unknown }) => ({
    ok: result.data !== undefined,
    slug: problemSlug(result.error),
  });

  return (
    <Card testID="driver-ride" className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('mobile.cars.driver.rideHeading')}
      </Text>
      {ride.status === 'assigned' || ride.status === 'arrived' || ride.status === 'in_progress' ? (
        <Text testID="driver-ride-status" className="font-body-bold text-body text-foreground">
          {t(`mobile.cars.driver.rideStatuses.${ride.status}`)}
        </Text>
      ) : null}
      <Text className="font-body text-body-sm text-foreground">
        {t('mobile.cars.driver.rider', { name: ride.riderFirstName })}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {t('mobile.cars.driver.pickup', { place: ride.pickup.label })}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {t('mobile.cars.driver.dropoff', { place: ride.dropoff.label })}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {t('mobile.cars.driver.offerEarnings', { amount: format.money(ride.earnings) })}
      </Text>
      {ride.status === 'assigned' ? (
        <Button
          testID="driver-arrived"
          loading={busy}
          onPress={() =>
            void act(async () =>
              outcome(await api.POST('/v1/drivers/me/rides/{rideId}/arrive', path)),
            )
          }
        >
          {t('mobile.cars.driver.arrived')}
        </Button>
      ) : null}
      {ride.status === 'arrived' && !ride.pinLocked ? (
        <>
          <Input
            testID="driver-pin"
            label={t('mobile.cars.driver.pin')}
            hint={t('mobile.cars.driver.pinHint')}
            value={pin}
            onChangeText={(value) => setPin(value.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={4}
            autoComplete="off"
          />
          <Button
            testID="driver-start"
            loading={busy}
            disabled={pin.length !== 4}
            onPress={() =>
              void act(async () =>
                outcome(
                  await api.POST('/v1/drivers/me/rides/{rideId}/start', {
                    ...path,
                    body: { pin },
                  }),
                ),
              )
            }
          >
            {t('mobile.cars.driver.start')}
          </Button>
        </>
      ) : null}
      {ride.pinLocked ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {t('mobile.cars.driver.pinLocked')}
        </Text>
      ) : null}
      {ride.status === 'in_progress' ? (
        <Button
          testID="driver-complete"
          loading={busy}
          onPress={() =>
            void act(async () =>
              outcome(await api.POST('/v1/drivers/me/rides/{rideId}/complete', path)),
            )
          }
        >
          {t('mobile.cars.driver.complete')}
        </Button>
      ) : null}
      {ride.status === 'assigned' || ride.status === 'arrived' ? (
        <Button
          testID="driver-hand-back"
          variant="ghost"
          loading={busy}
          onPress={() =>
            void act(async () =>
              outcome(await api.POST('/v1/drivers/me/rides/{rideId}/cancel', path)),
            )
          }
        >
          {t('mobile.cars.driver.handBack')}
        </Button>
      ) : null}
      <Alert message={error} />
    </Card>
  );
}

/**
 * Driving (ADR-050, ADR-051): online with a position, ride offers answered one at a time, the
 * current ride's steps (arrive, PIN, complete) and earnings. The app has no location access yet,
 * so the driver's position is the pick-up point they choose (backlog: device location).
 */
function DriverConsole({ profile }: { profile: Profile }) {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const places = usePlaces();
  const [where, setWhere] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = useQuery({
    queryKey: ['driver-state'],
    refetchInterval: 5_000,
    queryFn: async () => {
      const { data, response } = await api.GET('/v1/drivers/me/state');
      if (!data) throw new Error(String(response.status));
      return data;
    },
  });
  const online = state.data?.online ?? false;
  const riding = Boolean(state.data?.currentRideId);
  const offers = useQuery({
    queryKey: ['driver-offers'],
    enabled: online && !riding,
    refetchInterval: 3_000,
    queryFn: async () => {
      const { data, response } = await api.GET('/v1/drivers/me/offers');
      if (!data) throw new Error(String(response.status));
      return data.offers;
    },
  });
  const current = useQuery({
    queryKey: ['driver-ride'],
    enabled: riding,
    refetchInterval: 4_000,
    queryFn: async () => {
      const { data, response } = await api.GET('/v1/drivers/me/ride');
      if (!data) throw new Error(String(response.status));
      return data.ride;
    },
  });
  const earnings = useQuery({
    queryKey: ['driver-earnings'],
    queryFn: async () => {
      const { data, response } = await api.GET('/v1/drivers/me/earnings');
      if (!data) throw new Error(String(response.status));
      return data;
    },
  });
  const reload = () =>
    Promise.all([state.refetch(), offers.refetch(), current.refetch(), earnings.refetch()]);

  const inCity = (places.data ?? []).filter((place) => place.cityName === profile.cityName);
  const position = inCity.find((place) => place.id === where);

  const goOnline = async () => {
    if (!position) {
      setError(t('mobile.cars.driver.whereAreYou'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem } = await api.POST('/v1/drivers/me/online', {
        body: { position: { lat: position.lat, lng: position.lng } },
      });
      if (!data) {
        const reason = (problem as { reason?: string } | undefined)?.reason;
        setError(
          reason === 'licence_expired' || reason === 'insurance_expired'
            ? t('mobile.cars.driver.onlineErrors.expired')
            : reason === 'no_vehicle'
              ? t('mobile.cars.driver.onlineErrors.vehicle')
              : t('mobile.cars.driver.onlineErrors.generic'),
        );
      }
      await state.refetch();
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };
  const goOffline = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.POST('/v1/drivers/me/offline');
      if (!data) setError(t('mobile.cars.driver.onlineErrors.generic'));
      await state.refetch();
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };
  const answer = async (offerId: string, accept: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const params = { params: { path: { offerId } } };
      const result = accept
        ? await api.POST('/v1/drivers/me/offers/{offerId}/accept', params)
        : await api.POST('/v1/drivers/me/offers/{offerId}/decline', params);
      if (result.error) {
        setError(
          problemSlug(result.error) === 'offer-gone'
            ? t('mobile.cars.driver.offerGone')
            : t('mobile.cars.driver.actionError'),
        );
      }
      await reload();
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card testID="driver-console" className="gap-3 p-4">
        <Text testID="driver-online" className="font-heading text-h4 text-heading">
          {online ? t('mobile.cars.driver.online') : t('mobile.cars.driver.offline')}
        </Text>
        {!online ? (
          <>
            <ChoiceChips
              testID="driver-where"
              label={t('mobile.cars.driver.whereAreYou')}
              options={inCity.map((place) => ({ value: place.id, label: place.name }))}
              value={where}
              onChange={setWhere}
            />
            <Text className="font-body text-caption text-muted">
              {t('mobile.cars.driver.whereHint')}
            </Text>
            <Button testID="driver-go-online" loading={busy} onPress={() => void goOnline()}>
              {t('mobile.cars.driver.goOnline')}
            </Button>
          </>
        ) : !riding ? (
          <Button
            testID="driver-go-offline"
            variant="ghost"
            loading={busy}
            onPress={() => void goOffline()}
          >
            {t('mobile.cars.driver.goOffline')}
          </Button>
        ) : null}
        <Alert message={error} />
      </Card>

      {riding && current.data ? <CurrentRide ride={current.data} reload={reload} /> : null}

      {online && !riding ? (
        <Card testID="driver-offers" className="gap-3 p-4">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('mobile.cars.driver.offersHeading')}
          </Text>
          {(offers.data ?? []).length === 0 ? (
            <Text className="font-body text-body-sm text-foreground">
              {t('mobile.cars.driver.noOffers')}
            </Text>
          ) : (
            (offers.data ?? []).map((offer) => (
              <View key={offer.id} className="gap-2 rounded-lg border border-border p-3">
                <Text className="font-body-bold text-body text-foreground">
                  {t('mobile.cars.driver.offerRoute', {
                    pickup: offer.pickupLabel,
                    dropoff: offer.dropoffLabel,
                  })}
                </Text>
                <Text className="font-body text-body-sm text-foreground">
                  {t('mobile.cars.driver.offerDistance', {
                    pickupKm: format.number(kilometres(offer.distanceToPickupMetres)),
                    tripKm: format.number(kilometres(offer.tripDistanceMetres)),
                  })}
                </Text>
                <Text className="font-body text-body-sm text-foreground">
                  {t('mobile.cars.driver.offerEarnings', { amount: format.money(offer.earnings) })}
                </Text>
                <View className="flex-row gap-2">
                  <Button
                    testID={`offer-accept-${offer.id}`}
                    loading={busy}
                    onPress={() => void answer(offer.id, true)}
                  >
                    {t('mobile.cars.driver.accept')}
                  </Button>
                  <Button
                    testID={`offer-decline-${offer.id}`}
                    variant="ghost"
                    onPress={() => void answer(offer.id, false)}
                  >
                    {t('mobile.cars.driver.decline')}
                  </Button>
                </View>
              </View>
            ))
          )}
        </Card>
      ) : null}

      {earnings.data ? (
        <Card testID="driver-earnings" className="gap-2 p-4">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('mobile.cars.driver.earningsHeading')}
          </Text>
          <Text className="font-body-bold text-body text-foreground">
            {t('mobile.cars.driver.balance', { amount: format.money(earnings.data.balance) })}
          </Text>
          <Text className="font-body text-body-sm text-foreground">
            {t('mobile.cars.driver.today', { amount: format.money(earnings.data.summary.today) })}
          </Text>
          <Text className="font-body text-body-sm text-foreground">
            {t('mobile.cars.driver.week', {
              amount: format.money(earnings.data.summary.last7Days),
            })}
          </Text>
          <Text className="font-body-bold text-body-sm text-foreground">
            {t('mobile.cars.driver.payouts')}
          </Text>
          {earnings.data.payouts.length === 0 ? (
            <Text className="font-body text-body-sm text-muted">
              {t('mobile.cars.driver.noPayouts')}
            </Text>
          ) : (
            earnings.data.payouts.map((payout) => (
              <Text key={payout.id} className="font-body text-body-sm text-foreground">
                {format.date(payout.createdAt.slice(0, 10), 'medium')} ·{' '}
                {t('mobile.cars.driver.payout', {
                  amount: format.money(payout.amount),
                  status: t(`mobile.cars.driver.payoutStatuses.${payout.status}`),
                })}
              </Text>
            ))
          )}
        </Card>
      ) : null}
    </>
  );
}

function DriverHome() {
  const { api, user } = useApp();
  const { t } = useT();
  const profile = useQuery({
    queryKey: ['driver-profile'],
    queryFn: async (): Promise<Profile | null> => {
      const { data, response } = await api.GET('/v1/drivers/me/profile');
      if (data) return data;
      if (response.status === 404) return null;
      throw new Error(String(response.status));
    },
  });
  if (profile.isPending) return <Loading label={t('mobile.loading')} />;
  if (profile.data === null) return <DriverApply onApplied={() => profile.refetch()} />;
  if (!profile.data)
    return (
      <Notice
        body={t('mobile.networkError')}
        action={t('mobile.retry')}
        onAction={() => void profile.refetch()}
      />
    );
  const driver = profile.data;
  const canDrive = driver.status === 'approved' && Boolean(user?.roles.includes('driver'));
  return (
    <>
      {driver.status === 'approved' && !canDrive ? (
        <Notice body={t('mobile.cars.driver.signInAgain')} />
      ) : null}
      {canDrive ? <DriverConsole profile={driver} /> : null}
      <DriverProgress profile={driver} reload={() => profile.refetch()} />
    </>
  );
}

/** Driver mode: apply, finish the checks, then drive (Cars, ADR-050). */
export function DriverScreen() {
  const { t } = useT();
  return (
    <ScrollView
      testID="driver"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t('mobile.cars.driver.title') }} />
      <RequireAccount>
        <DriverHome />
      </RequireAccount>
    </ScrollView>
  );
}
