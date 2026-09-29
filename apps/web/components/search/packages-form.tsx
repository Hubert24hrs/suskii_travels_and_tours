'use client';

import {
  createPackagesFormSchema,
  packagesDraftToInput,
  packagesFormToParams,
  type CurrencyCode,
  type PackagesFormDraft,
} from '@suskii/shared';
import { Input, PassengerPicker, SegmentedControl } from '@suskii/ui-web';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';

import { CityField, type CityOption } from './city-field';
import { DateField } from './date-field';
import { FormFooter } from './form-footer';
import { focusFirstError, toFieldErrors, type FieldErrors } from './issues';
import { NativeSelect } from './native-select';
import { useTravellerLabels } from './traveller-labels';
import { useSearchT } from './use-search-t';

export interface PackagesFormProps {
  apiBaseUrl: string;
  locale: string;
  currency: CurrencyCode;
  suggestions: readonly CityOption[];
  initial?: { draft: PackagesFormDraft; city: CityOption | null } | undefined;
}

const budgetValue = (value: string): number | null =>
  /^\d{1,10}$/.test(value) ? Number(value) : null;

export default function PackagesForm({
  apiBaseUrl,
  locale,
  currency,
  suggestions,
  initial,
}: PackagesFormProps) {
  const { t } = useSearchT();
  const router = useRouter();
  const travellerLabels = useTravellerLabels();
  const [city, setCity] = useState<CityOption | null>(initial?.city ?? null);
  const [draft, setDraft] = useState<PackagesFormDraft>(
    initial?.draft ?? {
      cityId: '',
      whenType: 'month',
      month: '',
      from: '',
      to: '',
      travellers: { adults: 2, children: 0, infants: 0 },
      budgetCurrency: currency,
      budgetMin: null,
      budgetMax: null,
    },
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const update = (patch: Partial<PackagesFormDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const months = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const now = new Date();
    return Array.from({ length: 12 }, (_, offset) => {
      const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1));
      return { value: date.toISOString().slice(0, 7), label: formatter.format(date) };
    });
  }, [locale]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = packagesDraftToInput({
      ...draft,
      cityId: city?.id ?? '',
      month: draft.month || (months[0]?.value ?? ''),
    });
    const result = createPackagesFormSchema().safeParse(input);
    if (!result.success) {
      const found = toFieldErrors(result.error.issues, input, t);
      if (found['when.to'] && !found['when.from']) found['when.from'] = found['when.to'];
      setErrors(found);
      focusFirstError(found, 'package');
      return;
    }
    setErrors({});
    setSubmitting(true);
    router.push(`/packages?${packagesFormToParams(result.data).toString()}` as Route);
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-4"
      aria-label={t('search.tabs.packages')}
    >
      <div className="grid gap-3 lg:grid-cols-3 lg:items-start">
        <CityField
          id="package-cityId"
          label={t('search.packages.destination')}
          placeholder={t('search.hotels.destinationPlaceholder')}
          value={city}
          onChange={setCity}
          suggestions={suggestions}
          apiBaseUrl={apiBaseUrl}
          error={errors.cityId}
        />
        <div className="flex flex-col gap-2">
          <SegmentedControl<'month' | 'dates'>
            label={t('search.packages.when')}
            value={draft.whenType}
            onValueChange={(whenType) => update({ whenType })}
            options={[
              { value: 'month', label: t('search.packages.whenMonth') },
              { value: 'dates', label: t('search.packages.whenDates') },
            ]}
          />
          {draft.whenType === 'month' ? (
            <NativeSelect
              id="package-when-month"
              label={t('search.packages.month')}
              value={draft.month || (months[0]?.value ?? '')}
              onChange={(event) => update({ month: event.target.value })}
              options={months}
              error={errors['when.month']}
            />
          ) : (
            <DateField
              id="package-when-from"
              mode="range"
              label={t('search.packages.dates')}
              placeholder={t('search.hotels.datesPlaceholder')}
              locale={locale}
              from={draft.from}
              to={draft.to}
              onChange={(from, to) => update({ from, to })}
              error={errors['when.from']}
            />
          )}
        </div>
        <PassengerPicker
          id="package-travellers"
          label={t('search.travellers.label')}
          summary={travellerLabels.summary(draft.travellers)}
          value={draft.travellers}
          onChange={(travellers) => update({ travellers })}
          labels={travellerLabels.labels}
          error={errors['travellers.infants'] ?? errors.travellers}
        />
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:max-w-dialog">
        <legend className="mb-1 font-body text-body-sm font-medium text-foreground">
          {t('search.packages.budget')}{' '}
          <span className="text-muted">
            {t('search.packages.budgetHint', { currency: draft.budgetCurrency })}
          </span>
        </legend>
        <Input
          id="package-budget-min"
          label={t('search.packages.budgetMin')}
          inputMode="numeric"
          value={draft.budgetMin?.toString() ?? ''}
          onChange={(event) =>
            update({ budgetMin: budgetValue(event.target.value.replace(/\D/g, '')) })
          }
          error={errors['budget.min']}
        />
        <Input
          id="package-budget-max"
          label={t('search.packages.budgetMax')}
          inputMode="numeric"
          value={draft.budgetMax?.toString() ?? ''}
          onChange={(event) =>
            update({ budgetMax: budgetValue(event.target.value.replace(/\D/g, '')) })
          }
          error={errors['budget.max']}
        />
      </fieldset>
      <FormFooter
        label={t('search.packages.submit')}
        hasErrors={Object.keys(errors).length > 0}
        submitting={submitting}
      />
    </form>
  );
}
