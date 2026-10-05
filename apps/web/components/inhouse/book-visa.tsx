'use client';

import { useTranslator } from '@suskii/i18n/react';
import type { VisaPurpose } from '@suskii/shared';
import type { CurrencyCode, TravellerCounts } from '@suskii/shared/lite';
import { Button, Card, Input, PassengerPicker } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { browserApi, problemSlug } from '../../lib/browser-api';
import { NativeSelect } from '../search/native-select';
import { useTravellerLabels } from '../search/traveller-labels';

import type { BookVisaMessages } from './book-visa-messages';

interface Option {
  value: string;
  label: string;
}

const QUOTE_ISSUES = [
  'purpose_not_offered',
  'same_nationality_destination',
  'dates_invalid',
  'too_many_travellers',
] as const;
type QuoteIssue = (typeof QUOTE_ISSUES)[number];
const asIssue = (code: unknown): QuoteIssue | null =>
  (QUOTE_ISSUES as readonly unknown[]).includes(code) ? (code as QuoteIssue) : null;

/**
 * Booking visa assistance (ADR-026): applicants, their nationality, purpose and travel date, then
 * a quote checked against the product; every applicant later gets their own application.
 */
export function BookVisa({
  productId,
  purposes,
  countries,
  initial,
  currency,
}: {
  productId: string;
  purposes: readonly Option[];
  countries: readonly Option[];
  initial: {
    nationality: string;
    purpose: VisaPurpose;
    travelDate: string;
    travellers: TravellerCounts;
  };
  currency: CurrencyCode;
}) {
  const { t } = useTranslator<BookVisaMessages>();
  const travellerLabels = useTravellerLabels();
  const router = useRouter();
  const [nationality, setNationality] = useState(initial.nationality);
  const [purpose, setPurpose] = useState<VisaPurpose>(initial.purpose);
  const [travelDate, setTravelDate] = useState(initial.travelDate);
  const [travellers, setTravellers] = useState(initial.travellers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!nationality || !/^\d{4}-\d{2}-\d{2}$/.test(travelDate)) {
      setError(t('visa.book.errors.required'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const {
        data,
        error: problem,
        response,
      } = await browserApi().POST('/v1/inhouse-quotes', {
        body: { kind: 'visa', productId, purpose, nationality, travelDate, travellers, currency },
      });
      if (data) {
        router.push(`/checkout/${data.quoteId}`);
        return;
      }
      const issue = asIssue((problem as { code?: unknown } | undefined)?.code);
      setError(
        issue
          ? t(`visa.book.errors.${issue}`)
          : response.status === 404 || response.status === 410
            ? t('visa.book.errors.unavailable')
            : response.status === 429
              ? t('visa.book.errors.tooMany')
              : problemSlug(problem) === 'validation-failed'
                ? t('visa.book.errors.required')
                : t('visa.book.errors.generic'),
      );
    } catch {
      setError(t('visa.book.errors.generic'));
    }
    setBusy(false);
  };

  return (
    <Card asChild className="flex flex-col gap-4 p-4">
      <section aria-labelledby="book-visa-heading">
        <h2 id="book-visa-heading" className="font-heading text-h3 font-bold text-heading">
          {t('visa.book.heading')}
        </h2>
        <PassengerPicker
          id="visa-applicants"
          label={t('visa.book.applicants')}
          summary={travellerLabels.summary(travellers)}
          value={travellers}
          onChange={setTravellers}
          labels={travellerLabels.labels}
        />
        <NativeSelect
          id="visa-book-nationality"
          label={t('visa.book.nationality')}
          value={nationality}
          onChange={(event) => setNationality(event.target.value)}
          options={countries}
        />
        <NativeSelect
          id="visa-book-purpose"
          label={t('visa.book.purpose')}
          value={purpose}
          onChange={(event) => setPurpose(event.target.value as VisaPurpose)}
          options={purposes}
        />
        <Input
          id="visa-book-travelDate"
          type="date"
          label={t('visa.book.travelDate')}
          value={travelDate}
          onChange={(event) => setTravelDate(event.target.value)}
        />
        {error ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button fullWidth loading={busy} onClick={() => void submit()}>
          {busy ? t('visa.book.submitting') : t('visa.book.submit')}
        </Button>
      </section>
    </Card>
  );
}
