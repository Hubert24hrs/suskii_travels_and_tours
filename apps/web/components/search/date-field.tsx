'use client';

import { createFormatters } from '@suskii/i18n';
import { DateRangePicker } from '@suskii/ui-web';
import { useMemo } from 'react';

import { dateToIso, isoToDate, localToday, weekStartsOn } from './dates';
import { useSearchT } from './use-search-t';

export interface DateFieldProps {
  id: string;
  label: string;
  placeholder: string;
  locale: string;
  /** Start date (and end date in range mode) as YYYY-MM-DD, or empty. */
  from: string;
  to?: string;
  mode: 'single' | 'range';
  onChange: (from: string, to: string) => void;
  error?: string | undefined;
  className?: string;
}

/** Date or date-range field over calendar-date strings, localised and limited to today onward. */
export function DateField({
  id,
  label,
  placeholder,
  locale,
  from,
  to = '',
  mode,
  onChange,
  error,
  className,
}: DateFieldProps) {
  const { t } = useSearchT();
  const format = useMemo(() => createFormatters(locale), [locale]);
  const today = useMemo(() => localToday(), []);
  return (
    <DateRangePicker
      id={id}
      className={className}
      mode={mode}
      label={label}
      placeholder={placeholder}
      value={{ from: isoToDate(from), to: isoToDate(to) }}
      onChange={(value) => onChange(dateToIso(value.from), dateToIso(value.to))}
      formatValue={(value) => {
        const start = dateToIso(value.from);
        const end = dateToIso(value.to);
        if (!start) return undefined;
        return end ? format.dateRange(start, end, 'weekday') : format.date(start, 'weekday');
      }}
      minDate={today}
      weekStartsOn={weekStartsOn(locale)}
      labels={{
        done: t('search.datePicker.done'),
        close: t('search.datePicker.close'),
        previousMonth: t('search.datePicker.previousMonth'),
        nextMonth: t('search.datePicker.nextMonth'),
      }}
      error={error}
    />
  );
}
