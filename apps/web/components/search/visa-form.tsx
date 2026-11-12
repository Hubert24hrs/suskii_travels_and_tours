'use client';

import {
  VISA_PURPOSES,
  createVisaFormSchema,
  visaFormToParams,
  type VisaFormDraft,
  type VisaPurpose,
} from '@suskii/shared';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { CountryField } from './country-field';
import { DateField } from './date-field';
import { FormFooter } from './form-footer';
import { focusFirstError, toFieldErrors, type FieldErrors } from './issues';
import { NativeSelect } from './native-select';
import { useSearchT } from './use-search-t';

export interface VisaFormProps {
  apiBaseUrl: string;
  locale: string;
  initial?: VisaFormDraft | undefined;
}

/** Nationality from the locale's region as a starting point (en-NG -> Nigeria). */
const defaultNationality = (locale: string): string => locale.split('-')[1] ?? '';

export default function VisaForm({ apiBaseUrl, locale, initial }: VisaFormProps) {
  const { t } = useSearchT();
  const router = useRouter();
  const [draft, setDraft] = useState<VisaFormDraft>(
    initial ?? {
      nationality: defaultNationality(locale),
      destination: '',
      purpose: 'tourism',
      travelDate: '',
    },
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = createVisaFormSchema().safeParse(draft);
    if (!result.success) {
      const found = toFieldErrors(result.error.issues, draft, t);
      setErrors(found);
      focusFirstError(found, 'visa');
      return;
    }
    setErrors({});
    setSubmitting(true);
    router.push(`/visa?${visaFormToParams(result.data).toString()}` as Route);
  };

  return (
    <form
      method="get"
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-4"
      aria-label={t('search.tabs.visa')}
    >
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 lg:items-start">
        <CountryField
          id="visa-nationality"
          label={t('search.visa.nationality')}
          value={draft.nationality}
          onChange={(nationality) => setDraft({ ...draft, nationality })}
          apiBaseUrl={apiBaseUrl}
          error={errors.nationality}
        />
        <CountryField
          id="visa-destination"
          label={t('search.visa.destination')}
          value={draft.destination}
          onChange={(destination) => setDraft({ ...draft, destination })}
          apiBaseUrl={apiBaseUrl}
          error={errors.destination}
        />
        <NativeSelect
          id="visa-purpose"
          label={t('search.visa.purpose')}
          value={draft.purpose}
          onChange={(event) => setDraft({ ...draft, purpose: event.target.value as VisaPurpose })}
          options={VISA_PURPOSES.map((purpose) => ({
            value: purpose,
            label: t(`search.visa.purposes.${purpose}`),
          }))}
        />
        <DateField
          id="visa-travelDate"
          mode="single"
          label={t('search.visa.travelDate')}
          placeholder={t('search.flights.datePlaceholder')}
          locale={locale}
          from={draft.travelDate}
          onChange={(travelDate) => setDraft({ ...draft, travelDate })}
          error={errors.travelDate}
        />
      </div>
      <FormFooter
        label={t('search.visa.submit')}
        hasErrors={Object.keys(errors).length > 0}
        submitting={submitting}
      >
        <p className="font-body text-caption text-muted">{t('search.visa.disclaimer')}</p>
      </FormFooter>
    </form>
  );
}
