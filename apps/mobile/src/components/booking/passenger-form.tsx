import {
  GENDERS,
  PASSENGER_TITLES,
  transliterateName,
  type CheckoutIssue,
  type FieldIssues,
  type GuestDraft,
  type PassengerDraft,
} from '@suskii/shared';
import { Card, Input } from '@suskii/ui-native';
import { Text, View } from 'react-native';

import { useT } from '../../providers/app-provider';

import { ChoiceChips, CountryField } from './form-controls';

type Translate = ReturnType<typeof useT>['t'];

const issueText = (t: Translate, issue: CheckoutIssue | undefined): string | undefined =>
  issue ? t(`checkout.issues.${issue}`) : undefined;

/** One traveller as on the passport; passport fields are required abroad (ADR-015). */
export function PassengerForm({
  index,
  label,
  passenger,
  onChange,
  errors,
  warnings,
  passportRequired,
}: {
  index: number;
  label: string;
  passenger: PassengerDraft;
  onChange: (patch: Partial<PassengerDraft>) => void;
  errors: FieldIssues;
  warnings: FieldIssues;
  passportRequired: boolean;
}) {
  const { t } = useT();
  const prefix = `passengers.${index}`;
  const error = (field: string) => issueText(t, errors[`${prefix}.${field}`]);
  const given = transliterateName(passenger.givenNames);
  const surname = transliterateName(passenger.surname);
  return (
    <View testID={`passenger-${index}`}>
      <Card className="gap-3 p-4">
        <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
          {label}
        </Text>
        <Text className="font-body text-body-sm text-muted">{t('checkout.nameHint')}</Text>
        <ChoiceChips
          label={t('checkout.fields.title')}
          options={PASSENGER_TITLES.map((value) => ({
            value,
            label: t(`checkout.fields.titles.${value}`),
          }))}
          value={passenger.title as (typeof PASSENGER_TITLES)[number] | ''}
          onChange={(title) => onChange({ title })}
          error={error('title')}
        />
        <ChoiceChips
          label={t('checkout.fields.gender')}
          options={GENDERS.map((value) => ({
            value,
            label: t(`checkout.fields.genders.${value}`),
          }))}
          value={passenger.gender as (typeof GENDERS)[number] | ''}
          onChange={(gender) => onChange({ gender })}
          error={error('gender')}
        />
        <Input
          testID={`${prefix}.givenNames`}
          label={t('checkout.fields.givenNames')}
          value={passenger.givenNames}
          onChangeText={(givenNames) => onChange({ givenNames })}
          autoCapitalize="words"
          autoComplete="off"
          error={error('givenNames')}
        />
        <Input
          testID={`${prefix}.surname`}
          label={t('checkout.fields.surname')}
          value={passenger.surname}
          onChangeText={(value) => onChange({ surname: value })}
          autoCapitalize="words"
          autoComplete="off"
          error={error('surname')}
        />
        {given && surname ? (
          <Text className="font-body text-caption text-foreground">
            {t('checkout.namePreview', { name: `${surname}/${given}`.toUpperCase() })}
          </Text>
        ) : null}
        <Input
          testID={`${prefix}.dateOfBirth`}
          label={t('checkout.fields.dateOfBirth')}
          hint={t('mobile.checkout.dateHint')}
          value={passenger.dateOfBirth}
          onChangeText={(dateOfBirth) => onChange({ dateOfBirth: dateOfBirth.trim() })}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          error={error('dateOfBirth')}
        />
        <CountryField
          label={t('checkout.fields.nationality')}
          value={passenger.nationality}
          onChange={(nationality) => onChange({ nationality })}
          error={error('nationality')}
        />
        <Text accessibilityRole="header" className="pt-2 font-body-bold text-body text-heading">
          {t('checkout.passport')}
        </Text>
        <Text className="font-body text-body-sm text-muted">
          {passportRequired ? t('checkout.passportRequired') : t('checkout.passportOptional')}
        </Text>
        <Input
          testID={`${prefix}.passportNumber`}
          label={t('checkout.fields.passportNumber')}
          value={passenger.passportNumber}
          onChangeText={(passportNumber) => onChange({ passportNumber })}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          secureTextEntry={false}
          error={error('passportNumber')}
        />
        <CountryField
          label={t('checkout.fields.issuingCountry')}
          value={passenger.issuingCountry}
          onChange={(issuingCountry) => onChange({ issuingCountry })}
          error={error('issuingCountry')}
        />
        <Input
          testID={`${prefix}.passportExpiry`}
          label={t('checkout.fields.passportExpiry')}
          hint={t('mobile.checkout.dateHint')}
          value={passenger.passportExpiry}
          onChangeText={(passportExpiry) => onChange({ passportExpiry: passportExpiry.trim() })}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          error={error('passportExpiry') ?? issueText(t, warnings[`${prefix}.passportExpiry`])}
        />
      </Card>
    </View>
  );
}

/** Lead guest per hotel room (names only). */
export function GuestForm({
  index,
  guest,
  onChange,
  errors,
}: {
  index: number;
  guest: GuestDraft;
  onChange: (patch: Partial<GuestDraft>) => void;
  errors: FieldIssues;
}) {
  const { t } = useT();
  const prefix = `guests.${index}`;
  return (
    <Card className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('checkout.leadGuest', { number: index + 1 })}
      </Text>
      <Input
        label={t('checkout.fields.givenNames')}
        value={guest.givenNames}
        onChangeText={(givenNames) => onChange({ givenNames })}
        autoCapitalize="words"
        error={issueText(t, errors[`${prefix}.givenNames`])}
      />
      <Input
        label={t('checkout.fields.surname')}
        value={guest.surname}
        onChangeText={(value) => onChange({ surname: value })}
        autoCapitalize="words"
        error={issueText(t, errors[`${prefix}.surname`])}
      />
    </Card>
  );
}
