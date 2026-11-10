'use client';

import { Button, Card, Input } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { useAccount } from '../account/use-account';
import { AppLink } from '../app-link';
import { CheckboxField, NativeSelect } from '../search/native-select';

import { useCarsT } from './use-cars-t';

type Place = Schemas['RidePlaces']['places'][number];
type ExtraCode = Schemas['RentalVehicle']['extras'][number]['code'];
type IssueKey =
  'period' | 'tooLong' | 'unavailable' | 'chauffeur' | 'delivery' | 'driverAge' | 'option';
const ISSUE_KEYS: Record<string, IssueKey> = {
  period_invalid: 'period',
  too_long: 'tooLong',
  not_available: 'unavailable',
  chauffeur_unavailable: 'chauffeur',
  delivery_unavailable: 'delivery',
  delivery_too_far: 'delivery',
  driver_too_young: 'driverAge',
  extra_not_offered: 'option',
  extra_too_many: 'option',
  extra_duplicate: 'option',
  extra_with_chauffeur: 'option',
  return_branch_unavailable: 'option',
  cross_border_unavailable: 'option',
};

/**
 * Booking a car (ADR-051): the period in the branch's local time, a chauffeur where offered and
 * delivery to a known place where the car allows it, then a quote (signed in) and checkout. The
 * booking itself claims the car; a clash answers 409 there.
 *
 * The car's options (ADR-098) come with their labels already written by the server page (names,
 * prices and countries), so nothing here formats money or country names in the browser: the
 * driver's age for a self-drive rental, extras per day, a return to another branch and
 * cross-border cover. The API prices each one; this form only says what was chosen.
 */
export function BookRental({
  vehicleId,
  slug,
  chauffeurOffered,
  deliveryPlaces,
  minDriverAge,
  extras,
  returnBranches,
  crossBorderLabel,
  initial,
}: {
  vehicleId: string;
  slug: string;
  chauffeurOffered: boolean;
  deliveryPlaces: readonly Place[];
  minDriverAge: number;
  extras: readonly { code: ExtraCode; label: string; max: number }[];
  returnBranches: readonly { code: string; label: string }[];
  /** "Drive abroad: Benin and Ghana (+₦50,000.00)"; null when the car stays in the country. */
  crossBorderLabel: string | null;
  initial: { pickupAt: string; returnAt: string; chauffeur: boolean; driverAge: string };
}) {
  const { t } = useCarsT();
  const router = useRouter();
  const { phase } = useAccount();
  const [pickupAt, setPickupAt] = useState(initial.pickupAt);
  const [returnAt, setReturnAt] = useState(initial.returnAt);
  const [chauffeur, setChauffeur] = useState(initial.chauffeur && chauffeurOffered);
  const [delivery, setDelivery] = useState('');
  const [driverAge, setDriverAge] = useState(initial.driverAge);
  const [chosen, setChosen] = useState<Partial<Record<ExtraCode, number>>>({});
  const [returnBranch, setReturnBranch] = useState('');
  const [crossBorder, setCrossBorder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phase.kind === 'loading') return null;
  if (phase.kind !== 'ready') {
    return (
      <Card className="flex flex-col items-start gap-3 p-4">
        <p className="font-body text-body text-foreground">{t('cars.signInNote')}</p>
        <AppLink
          href={`/sign-in?next=${encodeURIComponent(`/rentals/${slug}`)}`}
          className="inline-flex min-h-12 items-center justify-center rounded-md bg-accent px-6 font-body text-body font-bold text-on-accent focus-visible:focus-ring"
        >
          {t('cars.signInFirst')}
        </AppLink>
      </Card>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!pickupAt || !returnAt || returnAt <= pickupAt) {
      setError(t('cars.rentals.book.errors.period'));
      return;
    }
    // A chauffeur drives a chauffeured car, so the renter's age is asked only for self-drive.
    const age = Number(driverAge);
    if (!chauffeur) {
      if (!Number.isInteger(age) || age < 18 || age > 99) {
        setError(t('cars.rentals.book.errors.driverAgeRequired'));
        return;
      }
      if (age < minDriverAge) {
        setError(t('cars.rentals.book.errors.driverAge'));
        return;
      }
    }
    const place = deliveryPlaces.find((item) => item.id === delivery);
    setBusy(true);
    try {
      const {
        data,
        error: problem,
        response,
      } = await browserApi().POST('/v1/inhouse-quotes', {
        body: {
          kind: 'rental',
          vehicleId,
          pickupAtLocal: pickupAt,
          returnAtLocal: returnAt,
          chauffeur,
          delivery: place ? { label: place.name, lat: place.lat, lng: place.lng } : null,
          driverAge: chauffeur ? null : age,
          extras: extras
            .map((extra) => ({ code: extra.code, quantity: chosen[extra.code] ?? 0 }))
            // The only driver of a chauffeured car is the chauffeur.
            .filter(
              (extra) => extra.quantity > 0 && !(chauffeur && extra.code === 'additional_driver'),
            ),
          returnBranch: returnBranch === '' ? null : returnBranch,
          crossBorder,
        },
      });
      if (data) {
        router.push(`/checkout/${data.quoteId}`);
        return;
      }
      const code = (problem as { code?: string } | undefined)?.code;
      const key = code ? ISSUE_KEYS[code] : undefined;
      setError(
        problemSlug(problem) === 'quote-invalid' && key
          ? t(`cars.rentals.book.errors.${key}`)
          : response.status === 429
            ? t('cars.rentals.book.errors.tooMany')
            : t('cars.rentals.book.errors.generic'),
      );
    } catch {
      setError(t('cars.rentals.book.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card asChild className="flex flex-col gap-4 p-4">
      <form
        method="post"
        noValidate
        onSubmit={(event) => void submit(event)}
        aria-labelledby="book-rental"
      >
        <h2 id="book-rental" className="font-heading text-h3 font-bold text-heading">
          {t('cars.rentals.book.heading')}
        </h2>
        <Input
          id="book-pickup"
          type="datetime-local"
          label={t('cars.rentals.book.pickupAt')}
          value={pickupAt}
          onChange={(event) => setPickupAt(event.target.value)}
        />
        <Input
          id="book-return"
          type="datetime-local"
          label={t('cars.rentals.book.returnAt')}
          value={returnAt}
          onChange={(event) => setReturnAt(event.target.value)}
        />
        {chauffeurOffered ? (
          <CheckboxField
            name="chauffeur"
            label={t('cars.rentals.book.chauffeur')}
            checked={chauffeur}
            onChange={(event) => setChauffeur(event.target.checked)}
          />
        ) : null}
        {deliveryPlaces.length > 0 ? (
          <NativeSelect
            id="book-delivery"
            label={t('cars.rentals.book.delivery')}
            options={[
              { value: '', label: t('cars.rentals.book.noDelivery') },
              ...deliveryPlaces.map((item) => ({ value: item.id, label: item.name })),
            ]}
            value={delivery}
            onChange={(event) => setDelivery(event.target.value)}
          />
        ) : null}
        {chauffeur ? null : (
          <Input
            id="book-driver-age"
            type="number"
            inputMode="numeric"
            min={18}
            max={99}
            label={t('cars.rentals.book.driverAge')}
            hint={t('cars.rentals.book.driverAgeHelp', { age: minDriverAge })}
            value={driverAge}
            onChange={(event) => setDriverAge(event.target.value)}
          />
        )}
        {extras.length > 0 ? (
          <fieldset className="flex flex-col gap-4">
            <legend className="pb-2 font-body text-body-sm font-bold text-foreground">
              {t('cars.rentals.book.extras')}
            </legend>
            {extras
              .filter((extra) => !(chauffeur && extra.code === 'additional_driver'))
              .map((extra) => (
                <NativeSelect
                  key={extra.code}
                  id={`book-extra-${extra.code}`}
                  label={extra.label}
                  options={[
                    { value: '0', label: t('cars.rentals.book.extraNone') },
                    ...Array.from({ length: extra.max }, (_, index) => ({
                      value: String(index + 1),
                      label: String(index + 1),
                    })),
                  ]}
                  value={String(chosen[extra.code] ?? 0)}
                  onChange={(event) =>
                    setChosen((current) => ({
                      ...current,
                      [extra.code]: Number(event.target.value),
                    }))
                  }
                />
              ))}
          </fieldset>
        ) : null}
        {returnBranches.length > 0 ? (
          <NativeSelect
            id="book-return-branch"
            label={t('cars.rentals.book.returnTo')}
            options={[
              { value: '', label: t('cars.rentals.book.sameBranch') },
              ...returnBranches.map((branch) => ({ value: branch.code, label: branch.label })),
            ]}
            value={returnBranch}
            onChange={(event) => setReturnBranch(event.target.value)}
          />
        ) : null}
        {crossBorderLabel ? (
          <CheckboxField
            name="crossBorder"
            label={crossBorderLabel}
            checked={crossBorder}
            onChange={(event) => setCrossBorder(event.target.checked)}
          />
        ) : null}
        {error ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={busy} data-testid="book-rental">
          {busy ? t('cars.rentals.book.submitting') : t('cars.rentals.book.submit')}
        </Button>
      </form>
    </Card>
  );
}
