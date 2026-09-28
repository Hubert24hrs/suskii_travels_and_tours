import { color } from '@suskii/design-tokens';
import { CalendarDays } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  addMonths,
  buildMonthGrid,
  dayPosition,
  isBeforeDay,
  selectDay,
  startOfDay,
  weekdayLabels,
  type DateRange,
  type DayPosition,
} from '../calendar/calendar';
import { cn } from '../lib/cn';
import { iconSize } from '../lib/icon';

import { Button } from './button';
import { FieldButton } from './field-button';
import { Sheet } from './sheet';

export type { DateRange };

export interface DateRangePickerLabels {
  done: string;
  close: string;
}

export interface DateRangePickerProps {
  mode: 'range' | 'single';
  label: string;
  value: DateRange;
  onChange: (value: DateRange) => void;
  formatValue: (value: DateRange) => string | undefined;
  placeholder: string;
  /** Earliest selectable day (default: today). */
  minDate?: Date;
  /** Months to show from the minimum date (default 12). */
  monthCount?: number;
  /** BCP 47 locale for month, weekday and day labels (default en-NG). */
  locale?: string;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  labels: DateRangePickerLabels;
  className?: string;
}

const cellClasses: Record<DayPosition, string> = {
  none: '',
  single: 'rounded-pill bg-primary',
  start: 'rounded-l-pill bg-primary',
  end: 'rounded-r-pill bg-primary',
  middle: 'bg-primary-subtle',
};

const labelClasses: Record<DayPosition, string> = {
  none: 'text-foreground',
  single: 'text-on-primary',
  start: 'text-on-primary',
  end: 'text-on-primary',
  middle: 'text-foreground',
};

/** Date or range picker: a scrollable run of months in a bottom sheet. */
export function DateRangePicker({
  mode,
  label,
  value,
  onChange,
  formatValue,
  placeholder,
  minDate,
  monthCount = 12,
  locale = 'en-NG',
  weekStartsOn = 1,
  labels,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const firstDay = useMemo(() => startOfDay(minDate ?? new Date()), [minDate]);
  const formatters = useMemo(
    () => ({
      month: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
      day: new Intl.DateTimeFormat(locale, { dateStyle: 'full' }),
    }),
    [locale],
  );
  const weekdays = useMemo(() => weekdayLabels(locale, weekStartsOn), [locale, weekStartsOn]);
  const months = useMemo(
    () => Array.from({ length: monthCount }, (_, offset) => addMonths(firstDay, offset)),
    [firstDay, monthCount],
  );

  return (
    <View className={className}>
      <FieldButton
        label={label}
        value={formatValue(value)}
        placeholder={placeholder}
        icon={<CalendarDays color={color.muted} size={iconSize.md} />}
        onPress={() => setOpen(true)}
      />
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={label}
        closeLabel={labels.close}
        snapPoints={['90%']}
        footer={
          <Button fullWidth onPress={() => setOpen(false)}>
            {labels.done}
          </Button>
        }
      >
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          className="flex-row"
        >
          {weekdays.map((weekday) => (
            <Text
              key={weekday}
              className="h-10 flex-1 text-center font-body-bold text-caption text-muted"
            >
              {weekday}
            </Text>
          ))}
        </View>
        {months.map((month) => (
          <View key={month.toISOString()} className="gap-1">
            <Text
              accessibilityRole="header"
              className="py-2 text-center font-heading text-body text-heading"
            >
              {formatters.month.format(month)}
            </Text>
            {buildMonthGrid(month.getFullYear(), month.getMonth(), weekStartsOn).map(
              (week, index) => (
                <View key={index} className="flex-row">
                  {week.map((day, cell) => {
                    if (!day) return <View key={cell} className="h-12 flex-1" />;
                    const disabled = isBeforeDay(day, firstDay);
                    const position = dayPosition(day, value);
                    const selected = position !== 'none';
                    return (
                      <Pressable
                        key={cell}
                        accessibilityRole="button"
                        accessibilityLabel={formatters.day.format(day)}
                        accessibilityState={{ disabled, selected }}
                        disabled={disabled}
                        onPress={() => onChange(selectDay(value, day, mode))}
                        className={cn(
                          'h-12 flex-1 items-center justify-center',
                          cellClasses[position],
                        )}
                      >
                        <Text
                          className={cn(
                            'font-body text-body',
                            disabled ? 'text-muted' : labelClasses[position],
                          )}
                        >
                          {day.getDate()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ),
            )}
          </View>
        ))}
      </Sheet>
    </View>
  );
}
