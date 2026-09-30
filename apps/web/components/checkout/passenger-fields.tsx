'use client';

import { useFormatters } from '@suskii/i18n/react';
import {
  GENDERS,
  PASSENGER_TITLES,
  transliterateName,
  type CheckoutIssue,
  type FieldIssues,
  type GuestDraft,
  type PassengerDraft,
} from '@suskii/shared/lite';
import { Card, Input } from '@suskii/ui-web';

import type { Schemas } from '../../lib/browser-api';
import { NativeSelect } from '../search/native-select';

import { useBookingT } from './checkout-messages';

export interface CountryOption {
  code: string;
  name: string;
}

function useIssue(errors: FieldIssues, warnings: FieldIssues) {
  const { t } = useBookingT();
  return (path: string): string | undefined => {
    const issue: CheckoutIssue | undefined = errors[path] ?? warnings[path];
    return issue ? t(`checkout.issues.${issue}`) : undefined;
  };
}

function NamePreview({ given, surname }: { given: string; surname: string }) {
  const { t } = useBookingT();
  const first = transliterateName(given);
  const last = transliterateName(surname);
  if (!first || !last) return null;
  return (
    <p className="font-body text-caption text-foreground md:col-span-2" aria-live="polite">
      {t('checkout.namePreview', { name: `${last}/${first}` })}
    </p>
  );
}

export function PassengerFields({
  index,
  label,
  value,
  onChange,
  countries,
  passportRequired,
  services,
  errors,
  warnings,
}: {
  index: number;
  label: string;
  value: PassengerDraft;
  onChange: (patch: Partial<PassengerDraft>) => void;
  countries: readonly CountryOption[];
  passportRequired: boolean;
  services: Schemas['FlightService'][];
  errors: FieldIssues;
  warnings: FieldIssues;
}) {
  const { t } = useBookingT();
  const format = useFormatters();
  const issue = useIssue(errors, warnings);
  const id = (field: string) => `passenger-${index}-${field}`;
  const path = (field: string) => `passengers.${index}.${field}`;
  const countryOptions = [
    { value: '', label: t('checkout.fields.choose') },
    ...countries.map((country) => ({ value: country.code, label: country.name })),
  ];
  const bag = value.type === 'infant' ? undefined : services[0];

  return (
    <Card asChild className="flex flex-col gap-4 p-4">
      <fieldset data-testid={`passenger-${index}`}>
        <legend className="mb-2 font-heading text-h4 font-bold text-heading">{label}</legend>
        <p className="font-body text-body-sm text-foreground">{t('checkout.nameHint')}</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <NativeSelect
            id={id('title')}
            label={t('checkout.fields.title')}
            value={value.title}
            onChange={(event) => onChange({ title: event.target.value })}
            error={issue(path('title'))}
            options={[
              { value: '', label: t('checkout.fields.choose') },
              ...PASSENGER_TITLES.map((title) => ({
                value: title,
                label: t(`checkout.fields.titles.${title}`),
              })),
            ]}
          />
          <NativeSelect
            id={id('gender')}
            label={t('checkout.fields.gender')}
            value={value.gender}
            onChange={(event) => onChange({ gender: event.target.value })}
            error={issue(path('gender'))}
            options={[
              { value: '', label: t('checkout.fields.choose') },
              ...GENDERS.map((gender) => ({
                value: gender,
                label: t(`checkout.fields.genders.${gender}`),
              })),
            ]}
          />
          <Input
            id={id('givenNames')}
            label={t('checkout.fields.givenNames')}
            autoComplete={index === 0 ? 'given-name' : 'off'}
            value={value.givenNames}
            onChange={(event) => onChange({ givenNames: event.target.value })}
            error={issue(path('givenNames'))}
          />
          <Input
            id={id('surname')}
            label={t('checkout.fields.surname')}
            autoComplete={index === 0 ? 'family-name' : 'off'}
            value={value.surname}
            onChange={(event) => onChange({ surname: event.target.value })}
            error={issue(path('surname'))}
          />
          <NamePreview given={value.givenNames} surname={value.surname} />
          <Input
            id={id('dateOfBirth')}
            type="date"
            label={t('checkout.fields.dateOfBirth')}
            value={value.dateOfBirth}
            onChange={(event) => onChange({ dateOfBirth: event.target.value })}
            error={issue(path('dateOfBirth'))}
          />
          <NativeSelect
            id={id('nationality')}
            label={t('checkout.fields.nationality')}
            value={value.nationality}
            onChange={(event) => onChange({ nationality: event.target.value })}
            error={issue(path('nationality'))}
            options={countryOptions}
          />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="font-heading text-body font-bold text-heading">
            {t('checkout.passport')}
          </h3>
          <p className="font-body text-body-sm text-foreground">
            {passportRequired ? t('checkout.passportRequired') : t('checkout.passportOptional')}
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input
              id={id('passportNumber')}
              label={t('checkout.fields.passportNumber')}
              autoComplete="off"
              value={value.passportNumber}
              onChange={(event) => onChange({ passportNumber: event.target.value })}
              error={issue(path('passportNumber'))}
            />
            <NativeSelect
              id={id('issuingCountry')}
              label={t('checkout.fields.issuingCountry')}
              value={value.issuingCountry}
              onChange={(event) => onChange({ issuingCountry: event.target.value })}
              error={issue(path('issuingCountry'))}
              options={countryOptions}
            />
            <Input
              id={id('passportExpiry')}
              type="date"
              label={t('checkout.fields.passportExpiry')}
              value={value.passportExpiry}
              onChange={(event) => onChange({ passportExpiry: event.target.value })}
              error={issue(path('passportExpiry'))}
            />
          </div>
        </div>
        {bag ? (
          <NativeSelect
            id={id('bags')}
            label={t('checkout.bagFor', {
              weight: bag.weightKg,
              name: transliterateName(value.givenNames) ?? label,
            })}
            value={String(value.bags)}
            onChange={(event) => onChange({ bags: Number(event.target.value) })}
            options={Array.from({ length: bag.maxQuantity + 1 }, (_, count) => ({
              value: String(count),
              label: t('checkout.bagOption', {
                count,
                price: format.money({
                  amountMinor: bag.price.amountMinor * count,
                  currency: bag.price.currency,
                }),
              }),
            }))}
          />
        ) : null}
      </fieldset>
    </Card>
  );
}

export function GuestFields({
  index,
  value,
  onChange,
  errors,
}: {
  index: number;
  value: GuestDraft;
  onChange: (patch: Partial<GuestDraft>) => void;
  errors: FieldIssues;
}) {
  const { t } = useBookingT();
  const issue = useIssue(errors, {});
  return (
    <Card asChild className="flex flex-col gap-4 p-4">
      <fieldset data-testid={`guest-${index}`}>
        <legend className="mb-2 font-heading text-h4 font-bold text-heading">
          {t('checkout.leadGuest', { number: index + 1 })}
        </legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            id={`guest-${index}-givenNames`}
            label={t('checkout.fields.givenNames')}
            value={value.givenNames}
            onChange={(event) => onChange({ givenNames: event.target.value })}
            error={issue(`guests.${index}.givenNames`)}
          />
          <Input
            id={`guest-${index}-surname`}
            label={t('checkout.fields.surname')}
            value={value.surname}
            onChange={(event) => onChange({ surname: event.target.value })}
            error={issue(`guests.${index}.surname`)}
          />
        </div>
      </fieldset>
    </Card>
  );
}
