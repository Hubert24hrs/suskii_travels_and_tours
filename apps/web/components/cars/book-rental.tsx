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
type IssueKey = 'period' | 'tooLong' | 'unavailable' | 'chauffeur' | 'delivery';
const ISSUE_KEYS: Record<string, IssueKey> = {
  period_invalid: 'period',
  too_long: 'tooLong',
  not_available: 'unavailable',
  chauffeur_unavailable: 'chauffeur',
  delivery_unavailable: 'delivery',
  delivery_too_far: 'delivery',
};

/**
 * Booking a car (ADR-051): the period in the branch's local time, a chauffeur where offered and
 * delivery to a known place where the car allows it, then a quote (signed in) and checkout. The
 * booking itself claims the car; a clash answers 409 there.
 */
export function BookRental({
  vehicleId,
  slug,
  chauffeurOffered,
  deliveryPlaces,
  initial,
}: {
  vehicleId: string;
  slug: string;
  chauffeurOffered: boolean;
  deliveryPlaces: readonly Place[];
  initial: { pickupAt: string; returnAt: string; chauffeur: boolean };
}) {
  const { t } = useCarsT();
  const router = useRouter();
  const { phase } = useAccount();
  const [pickupAt, setPickupAt] = useState(initial.pickupAt);
  const [returnAt, setReturnAt] = useState(initial.returnAt);
  const [chauffeur, setChauffeur] = useState(initial.chauffeur && chauffeurOffered);
  const [delivery, setDelivery] = useState('');
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
