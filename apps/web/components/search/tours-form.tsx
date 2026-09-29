'use client';

import { createToursFormSchema, toursFormToParams, type ToursFormDraft } from '@suskii/shared';
import { Input, PassengerPicker } from '@suskii/ui-web';
import { Compass } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { DateField } from './date-field';
import { FormFooter } from './form-footer';
import { focusFirstError, toFieldErrors, type FieldErrors } from './issues';
import { useTravellerLabels } from './traveller-labels';
import { useSearchT } from './use-search-t';

export interface ToursFormProps {
  locale: string;
  initial?: ToursFormDraft | undefined;
}

export default function ToursForm({ locale, initial }: ToursFormProps) {
  const { t } = useSearchT();
  const router = useRouter();
  const travellerLabels = useTravellerLabels();
  const [draft, setDraft] = useState<ToursFormDraft>(
    initial ?? { query: '', date: '', travellers: { adults: 2, children: 0, infants: 0 } },
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = createToursFormSchema().safeParse(draft);
    if (!result.success) {
      const found = toFieldErrors(result.error.issues, draft, t);
      setErrors(found);
      focusFirstError(found, 'tour');
      return;
    }
    setErrors({});
    setSubmitting(true);
    router.push(`/tours?${toursFormToParams(result.data).toString()}` as Route);
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-4"
      aria-label={t('search.tabs.tours')}
    >
      <div className="grid gap-3 lg:grid-cols-3 lg:items-start">
        <Input
          id="tour-query"
          label={t('search.tours.query')}
          placeholder={t('search.tours.queryPlaceholder')}
          icon={<Compass className="size-5" />}
          value={draft.query}
          maxLength={64}
          onChange={(event) => setDraft({ ...draft, query: event.target.value })}
          error={errors.query}
        />
        <DateField
          id="tour-date"
          mode="single"
          label={t('search.tours.date')}
          placeholder={t('search.flights.datePlaceholder')}
          locale={locale}
          from={draft.date}
          onChange={(date) => setDraft({ ...draft, date })}
          error={errors.date}
        />
        <PassengerPicker
          id="tour-travellers"
          label={t('search.travellers.label')}
          summary={travellerLabels.summary(draft.travellers)}
          value={draft.travellers}
          onChange={(travellers) => setDraft({ ...draft, travellers })}
          labels={travellerLabels.labels}
          error={errors['travellers.infants'] ?? errors.travellers}
        />
      </div>
      <FormFooter
        label={t('search.tours.submit')}
        hasErrors={Object.keys(errors).length > 0}
        submitting={submitting}
      />
    </form>
  );
}
