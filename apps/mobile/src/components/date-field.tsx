import { intlLocale, type Formatters } from '@suskii/i18n';
import { useFormatters } from '@suskii/i18n/react';
import { DatePicker, type DatePickerLabels } from '@suskii/ui-native';

import { useT } from '../providers/app-provider';

type Translate = ReturnType<typeof useT>['t'];

const pickerLabels = (t: Translate): DatePickerLabels => ({
  done: t('search.datePicker.done'),
  close: t('search.datePicker.close'),
  previousMonth: t('search.datePicker.previousMonth'),
  nextMonth: t('search.datePicker.nextMonth'),
  chooseYear: t('mobile.datePicker.chooseYear'),
  chooseMonth: t('mobile.datePicker.chooseMonth'),
  time: t('mobile.datePicker.time'),
  hour: t('mobile.datePicker.hour'),
  minutes: t('mobile.datePicker.minutes'),
});

/** A wall time (`YYYY-MM-DDTHH:mm`) as the app shows times: the date in words, then 24 hour time. */
export const wallTimeText = (format: Formatters, value: string): string =>
  `${format.date(value.slice(0, 10), 'medium')} ${value.slice(11, 16)}`;

interface FieldProps {
  /** The field; the sheet's parts take ids under it (`DatePicker` in ui-native). */
  testID: string;
  label: string;
  /** The value as the API takes it, or '' while none is chosen. */
  value: string;
  onChange: (value: string) => void;
  /** The first and last days that can be chosen (`YYYY-MM-DD`). */
  min: string;
  max: string;
  error?: string | undefined;
}

/**
 * A date (`YYYY-MM-DD`): a date of birth or an expiry date. The sheet opens on the years, so a
 * year, a month and a day reach any date in three taps (ADR-114). The field shows the date in
 * words; the form the API reads is never shown.
 */
export function DateField(props: FieldProps) {
  const { t, locale } = useT();
  const format = useFormatters();
  return (
    <DatePicker
      {...props}
      mode="date"
      start="year"
      formatValue={(value) => format.date(value, 'medium')}
      placeholder={t('mobile.datePicker.chooseDate')}
      locale={intlLocale(locale)}
      labels={pickerLabels(t)}
    />
  );
}

/**
 * A date and a wall time (`YYYY-MM-DDTHH:mm` on the 24 hour clock): a pickup, a return, an
 * arrival. The sheet opens on a month, with the hours and minutes under the days (ADR-114).
 */
export function DateTimeField({
  defaultTime,
  opensOn,
  ...props
}: FieldProps & {
  /** The time a chosen day takes while no time is chosen (`HH:mm`). */
  defaultTime?: string | undefined;
  /** The day whose month shows while nothing is chosen (default today). */
  opensOn?: string | undefined;
}) {
  const { t, locale } = useT();
  const format = useFormatters();
  return (
    <DatePicker
      {...props}
      mode="dateTime"
      start="day"
      defaultTime={defaultTime}
      opensOn={opensOn}
      formatValue={(value) => wallTimeText(format, value)}
      placeholder={t('mobile.datePicker.chooseDateTime')}
      locale={intlLocale(locale)}
      labels={pickerLabels(t)}
    />
  );
}
