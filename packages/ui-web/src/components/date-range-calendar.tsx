'use client';

import {
  DayPicker,
  type ClassNames,
  type DateRange,
  type DayPickerLocale,
  type Modifiers,
} from '@daypicker/react';

// Selected cells are highlighted on the <td>; `group` lets the day button react to that state.
const classNames: Partial<ClassNames> = {
  root: 'relative font-body text-foreground',
  months: 'flex flex-col gap-6 md:flex-row',
  month: 'flex flex-col gap-2',
  month_caption:
    'flex h-12 items-center justify-center font-heading text-body font-bold text-heading',
  nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
  button_previous:
    'inline-flex size-12 items-center justify-center rounded-pill text-primary hover:bg-primary-subtle focus-visible:focus-ring disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent',
  button_next:
    'inline-flex size-12 items-center justify-center rounded-pill text-primary hover:bg-primary-subtle focus-visible:focus-ring disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent',
  chevron: 'size-5 fill-current',
  month_grid: 'border-collapse',
  weekday: 'size-12 font-body text-caption font-bold text-muted',
  day: 'group p-0 text-center',
  day_button: [
    'inline-flex size-12 items-center justify-center rounded-pill font-body text-body',
    'transition-colors duration-fast hover:bg-primary-subtle focus-visible:focus-ring',
    'group-aria-selected:hover:bg-transparent disabled:cursor-not-allowed disabled:hover:bg-transparent',
  ].join(' '),
  selected: 'rounded-pill bg-primary text-on-primary',
  // `!` so range shapes never depend on stylesheet order against `selected`.
  range_start: 'rounded-e-none!',
  range_end: 'rounded-s-none!',
  range_middle: 'rounded-none! bg-primary-subtle! text-foreground!',
  today: 'font-bold',
  disabled: 'text-muted',
  outside: 'text-muted',
  hidden: 'invisible',
};

export interface DateRangeCalendarProps {
  mode: 'range' | 'single';
  value: DateRange;
  onChange: (value: DateRange) => void;
  numberOfMonths: 1 | 2;
  minDate?: Date | undefined;
  locale?: Partial<DayPickerLocale> | undefined;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | undefined;
  previousMonthLabel: string;
  nextMonthLabel: string;
  /** Day label templates with `{date}` ("Today, {date}", "{date}, selected"), other languages. */
  todayLabel?: string | undefined;
  selectedLabel?: string | undefined;
}

/**
 * Month, weekday and day names from Intl in the page's language, with Latin digits (ADR-076).
 * English pages keep DayPicker's own names and labels; so does a page that passes a date-fns
 * locale. The calendar only renders in the browser, after a picker opens.
 */
function pageNames(todayLabel: string | undefined, selectedLabel: string | undefined) {
  const lang = typeof document === 'undefined' ? '' : document.documentElement.lang;
  if (lang === '' || /^en(?:-|$)/i.test(lang)) return {};
  const tag = `${lang}-u-nu-latn`;
  const month = new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric' });
  const weekday = new Intl.DateTimeFormat(tag, { weekday: 'narrow' });
  const fullDate = new Intl.DateTimeFormat(tag, { dateStyle: 'full' });
  return {
    formatters: {
      formatCaption: (date: Date) => month.format(date),
      formatWeekdayName: (date: Date) => weekday.format(date),
    },
    labelDayButton: (date: Date, modifiers: Modifiers) => {
      let label = fullDate.format(date);
      if (modifiers.today && todayLabel) label = todayLabel.replace('{date}', label);
      if (modifiers.selected && selectedLabel) label = selectedLabel.replace('{date}', label);
      return label;
    },
  };
}

/**
 * The DayPicker calendar inside DateRangePicker, in its own module so the date library loads only
 * when a picker is about to open (it is not needed to render the form).
 */
export default function DateRangeCalendar({
  mode,
  value,
  onChange,
  numberOfMonths,
  minDate,
  locale,
  weekStartsOn,
  previousMonthLabel,
  nextMonthLabel,
  todayLabel,
  selectedLabel,
}: DateRangeCalendarProps) {
  const { formatters, labelDayButton } = locale ? {} : pageNames(todayLabel, selectedLabel);
  const shared = {
    numberOfMonths,
    classNames,
    autoFocus: true,
    dir: typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr',
    labels: {
      labelPrevious: () => previousMonthLabel,
      labelNext: () => nextMonthLabel,
      ...(labelDayButton ? { labelDayButton } : {}),
    },
    ...(formatters ? { formatters } : {}),
    ...(locale ? { locale } : {}),
    ...(minDate ? { disabled: { before: minDate }, startMonth: minDate } : {}),
    ...(weekStartsOn === undefined ? {} : { weekStartsOn }),
  };
  return mode === 'range' ? (
    <DayPicker
      {...shared}
      mode="range"
      excludeDisabled
      selected={value}
      onSelect={(range) => onChange(range ?? { from: undefined })}
    />
  ) : (
    <DayPicker
      {...shared}
      mode="single"
      selected={value.from}
      onSelect={(day) => onChange({ from: day, to: undefined })}
    />
  );
}
