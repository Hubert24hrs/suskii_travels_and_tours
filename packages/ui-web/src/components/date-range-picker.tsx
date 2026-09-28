'use client';

import { DayPicker, type ClassNames, type DateRange, type DayPickerLocale } from '@daypicker/react';
import { CalendarDays } from 'lucide-react';
import { useId, useState } from 'react';

import { useIsDesktop } from '../lib/use-media-query';

import { Button } from './button';
import { Dialog, DialogContent, DialogTrigger } from './dialog';
import { FieldButton, FieldLabel } from './field-trigger';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './popover';

export type { DateRange };

export interface DateRangePickerLabels {
  done: string;
  close: string;
  previousMonth: string;
  nextMonth: string;
}

export interface DateRangePickerProps {
  /** `single` hides the return date (one-way trips). */
  mode: 'range' | 'single';
  /** Field label, e.g. "Depart - Return". */
  label: string;
  value: DateRange;
  onChange: (value: DateRange) => void;
  /** Localised display of the value; return `undefined` to show the placeholder. */
  formatValue: (value: DateRange) => string | undefined;
  placeholder: string;
  /** Earliest selectable day, e.g. today in the origin airport's timezone. */
  minDate?: Date;
  /** date-fns locale for month and weekday names (default en-US). */
  locale?: Partial<DayPickerLocale>;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  labels: DateRangePickerLabels;
  className?: string;
}

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
  range_start: 'rounded-r-none!',
  range_end: 'rounded-l-none!',
  range_middle: 'rounded-none! bg-primary-subtle! text-foreground!',
  today: 'font-bold',
  disabled: 'text-muted',
  outside: 'text-muted',
  hidden: 'invisible',
};

/**
 * Date or date-range picker: two months in a popover on desktop, one month in a full-screen
 * dialog on mobile. Keyboard navigation and day labels come from DayPicker (WCAG 2.1 AA).
 */
export function DateRangePicker({
  mode,
  label,
  value,
  onChange,
  formatValue,
  placeholder,
  minDate,
  locale,
  weekStartsOn,
  labels,
  className,
}: DateRangePickerProps) {
  const labelId = useId();
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);

  const shared = {
    numberOfMonths: isDesktop && mode === 'range' ? 2 : 1,
    classNames,
    autoFocus: true,
    labels: { labelPrevious: () => labels.previousMonth, labelNext: () => labels.nextMonth },
    ...(minDate ? { disabled: { before: minDate }, startMonth: minDate } : {}),
    ...(locale ? { locale } : {}),
    ...(weekStartsOn === undefined ? {} : { weekStartsOn }),
  };

  const calendar =
    mode === 'range' ? (
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

  const trigger = (
    <FieldButton
      labelId={labelId}
      value={formatValue(value)}
      placeholder={placeholder}
      icon={<CalendarDays className="size-5" />}
    />
  );

  return (
    <div className={className}>
      <div className="flex flex-col gap-1">
        <FieldLabel id={labelId}>{label}</FieldLabel>
        {isDesktop ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent
              aria-label={label}
              className="flex flex-col gap-4"
              // DayPicker focuses the selected day (or today) itself.
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              {calendar}
              <PopoverClose asChild>
                <Button className="self-end">{labels.done}</Button>
              </PopoverClose>
            </PopoverContent>
          </Popover>
        ) : (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent
              title={label}
              closeLabel={labels.close}
              variant="fullscreen"
              onOpenAutoFocus={(event) => event.preventDefault()}
              footer={
                <Button fullWidth onClick={() => setOpen(false)}>
                  {labels.done}
                </Button>
              }
            >
              <div className="flex justify-center">{calendar}</div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
