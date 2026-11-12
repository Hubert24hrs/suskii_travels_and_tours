'use client';

import {
  ADDON_TYPES,
  addonsDraftToInput,
  addonsFormToParams,
  createAddonsFormSchema,
  type AddonType,
  type AddonsFormDraft,
} from '@suskii/shared';
import { Input, PassengerPicker, SegmentedControl } from '@suskii/ui-web';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { CityField, type CityOption } from './city-field';
import { DateField } from './date-field';
import { FormFooter } from './form-footer';
import { focusFirstError, toFieldErrors, type FieldErrors } from './issues';
import { NativeSelect } from './native-select';
import { readStored, STORAGE_KEYS, writeStored } from './storage';
import { useTravellerLabels } from './traveller-labels';
import { useSearchT } from './use-search-t';

export interface AddonsFormProps {
  apiBaseUrl: string;
  locale: string;
  suggestions: readonly CityOption[];
  initial?: { draft: AddonsFormDraft; city: CityOption | null } | undefined;
}

export default function AddonsForm({ apiBaseUrl, locale, suggestions, initial }: AddonsFormProps) {
  const { t } = useSearchT();
  const router = useRouter();
  const travellerLabels = useTravellerLabels();
  const [city, setCity] = useState<CityOption | null>(initial?.city ?? null);
  const [draft, setDraft] = useState<AddonsFormDraft>(
    initial?.draft ?? {
      mode: 'standalone',
      type: 'insurance',
      cityId: '',
      startDate: '',
      endDate: '',
      travellers: { adults: 1, children: 0, infants: 0 },
      bookingReference: '',
      lastName: '',
    },
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const update = (patch: Partial<AddonsFormDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  // A booking reference arrives in the URL; the last name typed on the previous page stays in
  // this tab's storage and is restored after hydration.
  useEffect(() => {
    if (draft.mode !== 'booking' || draft.lastName) return;
    const lastName = readStored<string>(STORAGE_KEYS.addonsLastName, 'session');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off restore from storage after mount.
    if (lastName) setDraft((current) => ({ ...current, lastName }));
  }, [draft.mode, draft.lastName]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = addonsDraftToInput({ ...draft, cityId: city?.id ?? '' });
    const result = createAddonsFormSchema().safeParse(input);
    if (!result.success) {
      const found = toFieldErrors(result.error.issues, input, t);
      if (found.endDate && !found.startDate) found.startDate = found.endDate;
      setErrors(found);
      focusFirstError(found, 'addon');
      return;
    }
    setErrors({});
    setSubmitting(true);
    // The last name is personal data: it never goes into the URL, only this tab's storage.
    if (result.data.mode === 'booking')
      writeStored(STORAGE_KEYS.addonsLastName, result.data.lastName, 'session');
    router.push(`/travel-add-ons?${addonsFormToParams(result.data).toString()}` as Route);
  };

  return (
    <form
      method="post"
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-4"
      aria-label={t('search.tabs.travel_addons')}
    >
      <SegmentedControl<AddonsFormDraft['mode']>
        label={t('search.addons.mode')}
        value={draft.mode}
        onValueChange={(mode) => update({ mode })}
        options={[
          { value: 'standalone', label: t('search.addons.modes.standalone') },
          { value: 'booking', label: t('search.addons.modes.booking') },
        ]}
      />
      {draft.mode === 'standalone' ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 lg:items-start">
          <NativeSelect
            id="addon-type"
            label={t('search.addons.type')}
            value={draft.type}
            onChange={(event) => update({ type: event.target.value as AddonType })}
            options={ADDON_TYPES.map((type) => ({
              value: type,
              label: t(`search.addons.types.${type}`),
            }))}
          />
          <CityField
            id="addon-cityId"
            label={t('search.addons.destination')}
            placeholder={t('search.hotels.destinationPlaceholder')}
            value={city}
            onChange={setCity}
            suggestions={suggestions}
            apiBaseUrl={apiBaseUrl}
            error={errors.cityId}
          />
          <DateField
            id="addon-startDate"
            mode="range"
            label={t('search.addons.dates')}
            placeholder={t('search.hotels.datesPlaceholder')}
            locale={locale}
            from={draft.startDate}
            to={draft.endDate}
            onChange={(startDate, endDate) => update({ startDate, endDate })}
            error={errors.startDate}
          />
          <PassengerPicker
            id="addon-travellers"
            label={t('search.travellers.label')}
            summary={travellerLabels.summary(draft.travellers)}
            value={draft.travellers}
            onChange={(travellers) => update({ travellers })}
            labels={travellerLabels.labels}
            error={errors['travellers.infants'] ?? errors.travellers}
          />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:max-w-dialog">
          <Input
            id="addon-bookingReference"
            label={t('search.addons.bookingReference')}
            hint={t('search.addons.bookingReferenceHint')}
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={8}
            value={draft.bookingReference}
            onChange={(event) => update({ bookingReference: event.target.value })}
            error={errors.bookingReference}
          />
          <Input
            id="addon-lastName"
            label={t('search.addons.lastName')}
            autoComplete="family-name"
            maxLength={60}
            value={draft.lastName}
            onChange={(event) => update({ lastName: event.target.value })}
            error={errors.lastName}
          />
        </div>
      )}
      <FormFooter
        label={
          draft.mode === 'booking' ? t('search.addons.submitBooking') : t('search.addons.submit')
        }
        hasErrors={Object.keys(errors).length > 0}
        submitting={submitting}
      />
    </form>
  );
}
