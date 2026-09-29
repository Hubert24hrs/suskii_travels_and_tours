'use client';

import type { DateRange, DayPickerLocale } from '@daypicker/react';
import { CalendarDays } from 'lucide-react';
import { lazy, Suspense, useId } from 'react';

import { useIsDesktop } from '../lib/use-media-query';

import { Button } from './button';
import { DeferredDialog, DeferredPopover, useDeferredOverlay } from './deferred-overlay';
import { FieldButton, FieldLabel } from './field-trigger';

const loadCalendar = () => import('./date-range-calendar');
const DateRangeCalendar = lazy(loadCalendar);
/** Fetches the calendar code ahead of opening (hover or focus on the trigger). */
const prefetchCalendar = () => {
  loadCalendar().catch(() => undefined);
};

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
  /** Validation message; marks the field invalid and is announced with it. */
  error?: string | undefined;
  /** Id of the trigger button (for focusing the first invalid field). */
  id?: string;
  className?: string;
}

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
  error,
  id,
  className,
}: DateRangePickerProps) {
  const labelId = useId();
  const isDesktop = useIsDesktop();
  const overlay = useDeferredOverlay();
  const close = () => overlay.setOpen(false);
  // Hover or focus on the field fetches the overlay and calendar code before the first open.
  const prefetch = () => {
    overlay.triggerProps.onPointerEnter();
    prefetchCalendar();
  };

  const calendar = (
    <Suspense fallback={<div aria-hidden="true" className="h-20" />}>
      <DateRangeCalendar
        mode={mode}
        value={value}
        onChange={onChange}
        numberOfMonths={isDesktop && mode === 'range' ? 2 : 1}
        minDate={minDate}
        locale={locale}
        weekStartsOn={weekStartsOn}
        previousMonthLabel={labels.previousMonth}
        nextMonthLabel={labels.nextMonth}
      />
    </Suspense>
  );

  const errorId = error ? `${labelId}-error` : undefined;
  const trigger = (
    <FieldButton
      id={id}
      labelId={labelId}
      value={formatValue(value)}
      placeholder={placeholder}
      icon={<CalendarDays className="size-5" />}
      aria-invalid={error ? true : undefined}
      aria-describedby={errorId}
      className={error ? 'border-danger' : undefined}
      {...overlay.triggerProps}
      onPointerEnter={prefetch}
      onFocus={prefetch}
    />
  );

  return (
    <div className={className}>
      <div className="flex flex-col gap-1">
        <FieldLabel id={labelId}>{label}</FieldLabel>
        {trigger}
        {isDesktop ? (
          <DeferredPopover
            overlay={overlay}
            label={label}
            className="flex flex-col gap-4"
            // DayPicker focuses the selected day (or today) itself.
            skipAutoFocus
          >
            {calendar}
            <Button className="self-end" onClick={close}>
              {labels.done}
            </Button>
          </DeferredPopover>
        ) : (
          <DeferredDialog
            overlay={overlay}
            title={label}
            closeLabel={labels.close}
            variant="fullscreen"
            skipAutoFocus
            footer={
              <Button fullWidth onClick={close}>
                {labels.done}
              </Button>
            }
          >
            <div className="flex justify-center">{calendar}</div>
          </DeferredDialog>
        )}
        {error ? (
          <p id={errorId} className="font-body text-caption text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
