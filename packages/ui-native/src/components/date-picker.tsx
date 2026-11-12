import { color } from '@suskii/design-tokens';
import {
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import {
  I18nManager,
  Keyboard,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type ScrollView,
} from 'react-native';

import { buildMonthGrid, weekdayLabels } from '../calendar/calendar';
import {
  clampDay,
  dayInRange,
  fromIsoDay,
  HOURS,
  joinDateValue,
  minuteOptions,
  monthInRange,
  NO_PARTS,
  rowsOf,
  shiftMonth,
  splitDateValue,
  toIsoDay,
  yearsBetween,
  type DateFieldMode,
  type DateParts,
} from '../calendar/date-value';
import { cn } from '../lib/cn';
import { iconSize } from '../lib/icon';

import { Button } from './button';
import { FieldButton } from './field-button';
import { Sheet } from './sheet';

export interface DatePickerLabels {
  done: string;
  close: string;
  previousMonth: string;
  nextMonth: string;
  /** Heading of the years; also what the title of a month or a year says it opens. */
  chooseYear: string;
  /** Heading of the months. */
  chooseMonth: string;
  /** Date and time: heading of the time, naming the 24 hour clock. */
  time: string;
  hour: string;
  minutes: string;
}

export interface DatePickerProps {
  /** `date` holds `YYYY-MM-DD`; `dateTime` a wall time, `YYYY-MM-DDTHH:mm` on the 24 hour clock. */
  mode: DateFieldMode;
  label: string;
  /** The value as the API takes it, or '' while none is chosen. */
  value: string;
  /** Called with a complete value when Done is pressed; closing the sheet keeps the old one. */
  onChange: (value: string) => void;
  /** The words for a value (the app formats it); the field never shows the ISO form. */
  formatValue: (value: string) => string;
  placeholder: string;
  /** The first and last days that can be chosen (`YYYY-MM-DD`). */
  min: string;
  max: string;
  /** What opens while nothing is chosen: the years (a birth or an expiry date) or a month. */
  start?: 'year' | 'day' | undefined;
  /** The day whose month shows while nothing is chosen (default today), kept within the range. */
  opensOn?: string | undefined;
  /** Date and time: the time a chosen day takes while no time is chosen (`HH:mm`). */
  defaultTime?: string | undefined;
  /** Minutes offered, every `minuteStep` (default 5). */
  minuteStep?: number | undefined;
  /** BCP 47 locale for month, weekday and day names (the Latin-digit form, as the app formats). */
  locale?: string;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  labels: DatePickerLabels;
  error?: string | undefined;
  className?: string;
  /**
   * UI tests: the field; `{testID}-sheet`, `{testID}-value` (what Done keeps) and
   * `{testID}-done`; `{testID}-years` (the title that opens the years), `{testID}-previous` and
   * `{testID}-next`; years `{testID}-year-YYYY`, months `{testID}-month-YYYY-MM`, days
   * `{testID}-day-YYYY-MM-DD`, hours `{testID}-hour-HH` and minutes `{testID}-minute-MM`.
   */
  testID?: string;
}

type Pane = 'year' | 'month' | 'day';

/** What the open sheet shows and what has been chosen in it; Done turns it into the value. */
interface Session {
  pane: Pane;
  /** The month on show (`YYYY-MM`); the months listed are those of its year. */
  month: string;
  parts: DateParts;
  /** The phone's date when the sheet opened, which orders the years. */
  today: string;
}

interface Formatters {
  /** "April 1990" */
  title: Intl.DateTimeFormat;
  /** "April" */
  month: Intl.DateTimeFormat;
  /** "Saturday 21 April 1990", the name of a day for screen readers. */
  day: Intl.DateTimeFormat;
}

/** A test id under the field's (`{testID}-{suffix}`), or none when the field has none. */
type TestIds = (suffix: string) => string | undefined;

const YEARS_PER_ROW = 4;
const MONTHS_PER_ROW = 3;
const TIMES_PER_ROW = 6;

const optionClasses = (selected: boolean): string =>
  selected
    ? 'h-12 flex-1 items-center justify-center rounded-pill bg-primary'
    : 'h-12 flex-1 items-center justify-center rounded-pill active:bg-primary-subtle';

const optionText = (selected: boolean, disabled: boolean): string =>
  selected
    ? 'font-body-bold text-body text-on-primary'
    : cn('font-body text-body', disabled ? 'text-muted' : 'text-foreground');

/** Empty cells that keep the last row of a grid aligned. */
function Padding({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <View key={`pad-${index}`} className="flex-1" />
      ))}
    </>
  );
}

/** The title of a month or a year, which opens the years. */
function YearsButton({
  title,
  hint,
  onPress,
  testID,
}: {
  title: string;
  hint: string;
  onPress: () => void;
  testID: string | undefined;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityHint={hint}
      onPress={onPress}
      className="min-h-12 flex-1 flex-row items-center justify-center gap-2 rounded-pill px-2 active:bg-primary-subtle"
    >
      <Text numberOfLines={1} className="font-heading text-body text-heading">
        {title}
      </Text>
      <ChevronDown color={color.primary} size={iconSize.md} />
    </Pressable>
  );
}

/** The years, in rows; the row of the year on show reports where it sits. */
function YearsPane({
  years,
  shownYear,
  chosenYear,
  heading,
  onChoose,
  onPlace,
  ids,
}: {
  years: readonly number[];
  shownYear: number;
  chosenYear: string;
  heading: string;
  onChoose: (year: number) => void;
  onPlace: (part: 'list' | 'row', event: LayoutChangeEvent) => void;
  ids: TestIds;
}) {
  return (
    <>
      <Text accessibilityRole="header" className="font-body-bold text-body text-heading">
        {heading}
      </Text>
      <View className="gap-2" onLayout={(event) => onPlace('list', event)}>
        {rowsOf(years, YEARS_PER_ROW).map((row) => (
          <View
            key={row.join()}
            className="flex-row gap-2"
            onLayout={row.includes(shownYear) ? (event) => onPlace('row', event) : undefined}
          >
            {row.map((year) => {
              const selected = String(year) === chosenYear;
              return (
                <Pressable
                  key={year}
                  testID={ids(`year-${year}`)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onChoose(year)}
                  className={optionClasses(selected)}
                >
                  <Text className={optionText(selected, false)}>{year}</Text>
                </Pressable>
              );
            })}
            <Padding count={YEARS_PER_ROW - row.length} />
          </View>
        ))}
      </View>
    </>
  );
}

/** The twelve months of a year; those with no day in the range are disabled. */
function MonthsPane({
  year,
  chosenMonth,
  min,
  max,
  formatters,
  labels,
  onChoose,
  onYears,
  ids,
}: {
  year: string;
  chosenMonth: string;
  min: string;
  max: string;
  formatters: Formatters;
  labels: DatePickerLabels;
  onChoose: (month: string) => void;
  onYears: () => void;
  ids: TestIds;
}) {
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`;
    return { month, date: fromIsoDay(`${month}-01`) ?? new Date(0) };
  });
  return (
    <>
      <View className="flex-row">
        <YearsButton
          title={year}
          hint={labels.chooseYear}
          onPress={onYears}
          testID={ids('years')}
        />
      </View>
      <Text accessibilityRole="header" className="font-body-bold text-body text-heading">
        {labels.chooseMonth}
      </Text>
      <View className="gap-2">
        {rowsOf(months, MONTHS_PER_ROW).map((row) => (
          <View key={row.map((item) => item.month).join()} className="flex-row gap-2">
            {row.map(({ month, date }) => {
              const disabled = !monthInRange(month, min, max);
              const selected = month === chosenMonth;
              return (
                <Pressable
                  key={month}
                  testID={ids(`month-${month}`)}
                  accessibilityRole="button"
                  accessibilityLabel={formatters.title.format(date)}
                  accessibilityState={{ disabled, selected }}
                  disabled={disabled}
                  onPress={() => onChoose(month)}
                  className={optionClasses(selected)}
                >
                  <Text numberOfLines={1} className={optionText(selected, disabled)}>
                    {formatters.month.format(date)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </>
  );
}

/** A month as a grid of days, with previous and next and its title opening the years. */
function DaysPane({
  month,
  chosenDay,
  min,
  max,
  weekStartsOn,
  weekdays,
  formatters,
  labels,
  onMonth,
  onYears,
  onChoose,
  ids,
}: {
  month: string;
  chosenDay: string;
  min: string;
  max: string;
  weekStartsOn: number;
  weekdays: readonly string[];
  formatters: Formatters;
  labels: DatePickerLabels;
  onMonth: (month: string) => void;
  onYears: () => void;
  onChoose: (day: string) => void;
  ids: TestIds;
}) {
  const first = fromIsoDay(`${month}-01`) ?? new Date(0);
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const canGoBack = monthInRange(previous, min, max);
  const canGoForward = monthInRange(next, min, max);
  // In Arabic the row runs right to left: "previous" sits on the right and points right.
  const [Back, Forward] = I18nManager.isRTL
    ? [ChevronRight, ChevronLeft]
    : [ChevronLeft, ChevronRight];
  return (
    <>
      <View className="flex-row items-center justify-between gap-2">
        <Pressable
          testID={ids('previous')}
          accessibilityRole="button"
          accessibilityLabel={labels.previousMonth}
          accessibilityState={{ disabled: !canGoBack }}
          disabled={!canGoBack}
          onPress={() => onMonth(previous)}
          className="size-12 items-center justify-center rounded-pill active:bg-primary-subtle"
        >
          <Back color={canGoBack ? color.primary : color.muted} size={iconSize.lg} />
        </Pressable>
        <YearsButton
          title={formatters.title.format(first)}
          hint={labels.chooseYear}
          onPress={onYears}
          testID={ids('years')}
        />
        <Pressable
          testID={ids('next')}
          accessibilityRole="button"
          accessibilityLabel={labels.nextMonth}
          accessibilityState={{ disabled: !canGoForward }}
          disabled={!canGoForward}
          onPress={() => onMonth(next)}
          className="size-12 items-center justify-center rounded-pill active:bg-primary-subtle"
        >
          <Forward color={canGoForward ? color.primary : color.muted} size={iconSize.lg} />
        </Pressable>
      </View>
      <View className="gap-1">
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
        {buildMonthGrid(first.getFullYear(), first.getMonth(), weekStartsOn).map((week, index) => (
          <View key={index} className="flex-row">
            {week.map((date, cell) => {
              if (!date) return <View key={cell} className="h-12 flex-1" />;
              const day = toIsoDay(date);
              const disabled = !dayInRange(day, min, max);
              const selected = day === chosenDay;
              return (
                <Pressable
                  key={cell}
                  testID={ids(`day-${day}`)}
                  accessibilityRole="button"
                  accessibilityLabel={formatters.day.format(date)}
                  accessibilityState={{ disabled, selected }}
                  disabled={disabled}
                  onPress={() => onChoose(day)}
                  className={optionClasses(selected)}
                >
                  <Text className={optionText(selected, disabled)}>{date.getDate()}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </>
  );
}

/** One choice among hours or minutes: a radio group of chips in rows (`{testID}-{option}`). */
function TimeChoices({
  label,
  options,
  value,
  onChoose,
  testID,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChoose: (option: string) => void;
  testID: string | undefined;
}) {
  return (
    <View className="gap-2">
      <Text
        importantForAccessibility="no"
        accessibilityElementsHidden
        className="font-body-medium text-body-sm text-foreground"
      >
        {label}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} className="gap-2">
        {rowsOf(options, TIMES_PER_ROW).map((row) => (
          <View key={row.join()} className="flex-row gap-2">
            {row.map((option) => {
              const checked = option === value;
              return (
                <Pressable
                  key={option}
                  testID={testID ? `${testID}-${option}` : undefined}
                  accessibilityRole="radio"
                  accessibilityState={{ checked }}
                  onPress={() => onChoose(option)}
                  className={cn(optionClasses(checked), !checked && 'border border-border-strong')}
                >
                  <Text className={optionText(checked, false)}>{option}</Text>
                </Pressable>
              );
            })}
            <Padding count={TIMES_PER_ROW - row.length} />
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * A date, or a date and a time, chosen in a bottom sheet. The years and the months are lists of
 * their own, so a date of birth decades back takes three taps; the days are a month grid with
 * previous and next; a time is an hour and minutes on the 24 hour clock. The value is the ISO
 * form the API takes, changed only by Done; the field shows `formatValue` of it.
 */
export function DatePicker({
  mode,
  label,
  value,
  onChange,
  formatValue,
  placeholder,
  min,
  max,
  start = 'day',
  opensOn,
  defaultTime,
  minuteStep = 5,
  locale = 'en-NG',
  weekStartsOn = 1,
  labels,
  error,
  className,
  testID,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  // Kept while the sheet slides away, so its content does not vanish first.
  const [session, setSession] = useState<Session>({
    pane: start,
    month: min.slice(0, 7),
    parts: NO_PARTS,
    today: min,
  });
  const scroll = useRef<ScrollView>(null);
  // Where the list of years and the row of the year on show sit, to open the list there.
  const yearsAt = useRef<{ list?: number; row?: number }>({});

  const formatters = useMemo<Formatters>(
    () => ({
      title: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
      month: new Intl.DateTimeFormat(locale, { month: 'long' }),
      day: new Intl.DateTimeFormat(locale, { dateStyle: 'full' }),
    }),
    [locale],
  );
  const weekdays = useMemo(() => weekdayLabels(locale, weekStartsOn), [locale, weekStartsOn]);
  const ids: TestIds = (suffix) => (testID ? `${testID}-${suffix}` : undefined);

  const shown = splitDateValue(value, mode) ? formatValue(value) : undefined;
  const chosen = joinDateValue(session.parts, mode);

  const toTop = () => scroll.current?.scrollTo({ y: 0, animated: false });

  const openSheet = () => {
    // A field typed in just before (a surname) keeps the keyboard up over the sheet's Done.
    Keyboard.dismiss();
    const today = toIsoDay(new Date());
    const parts = splitDateValue(value, mode);
    yearsAt.current = {};
    setSession({
      pane: parts ? 'day' : start,
      month: clampDay(parts?.day ?? opensOn ?? today, min, max).slice(0, 7),
      parts: parts ?? NO_PARTS,
      today,
    });
    setOpen(true);
  };

  const done = () => {
    if (chosen) onChange(chosen);
    setOpen(false);
  };

  const showYears = () => {
    yearsAt.current = {};
    setSession((current) => ({ ...current, pane: 'year' }));
  };

  const placeYears = (part: 'list' | 'row', event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    // The row before the year on show stays in view above it.
    yearsAt.current[part] = part === 'row' ? y - height : y;
    const { list, row } = yearsAt.current;
    if (list !== undefined && row !== undefined) {
      scroll.current?.scrollTo({ y: Math.max(0, list + row), animated: false });
    }
  };

  const chooseYear = (year: number) => {
    setSession((current) => ({
      ...current,
      pane: 'month',
      month: `${year}${current.month.slice(4)}`,
    }));
    toTop();
  };

  const chooseMonth = (month: string) => {
    setSession((current) => ({ ...current, pane: 'day', month }));
    toTop();
  };

  const showMonth = (month: string) => setSession((current) => ({ ...current, month }));

  const chooseDay = (day: string) => {
    const [hour = '', minute = ''] =
      mode === 'dateTime' && defaultTime ? defaultTime.split(':') : [];
    setSession((current) => ({
      ...current,
      parts: {
        day,
        hour: current.parts.hour || hour,
        minute: current.parts.minute || minute,
      },
    }));
  };

  const chooseHour = (hour: string) =>
    setSession((current) => ({
      ...current,
      // An hour alone is a time on the hour until minutes are chosen.
      parts: { ...current.parts, hour, minute: current.parts.minute || '00' },
    }));

  const chooseMinute = (minute: string) =>
    setSession((current) => ({ ...current, parts: { ...current.parts, minute } }));

  return (
    <View className={className}>
      <FieldButton
        testID={testID}
        label={label}
        value={shown}
        placeholder={placeholder}
        error={error}
        icon={
          mode === 'dateTime' ? (
            <CalendarClock color={color.muted} size={iconSize.md} />
          ) : (
            <CalendarDays color={color.muted} size={iconSize.md} />
          )
        }
        onPress={openSheet}
      />
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={label}
        closeLabel={labels.close}
        snapPoints={['90%']}
        scrollRef={scroll}
        testID={ids('sheet')}
        footer={
          <Button testID={ids('done')} fullWidth disabled={!chosen} onPress={done}>
            {labels.done}
          </Button>
        }
      >
        <Text
          testID={ids('value')}
          accessibilityLiveRegion="polite"
          className={cn('font-body-bold text-body', chosen ? 'text-foreground' : 'text-muted')}
        >
          {chosen ? formatValue(chosen) : placeholder}
        </Text>
        {session.pane === 'year' ? (
          <YearsPane
            years={yearsBetween(min, max, session.today)}
            shownYear={Number(session.month.slice(0, 4))}
            chosenYear={session.parts.day.slice(0, 4)}
            heading={labels.chooseYear}
            onChoose={chooseYear}
            onPlace={placeYears}
            ids={ids}
          />
        ) : session.pane === 'month' ? (
          <MonthsPane
            year={session.month.slice(0, 4)}
            chosenMonth={session.parts.day.slice(0, 7)}
            min={min}
            max={max}
            formatters={formatters}
            labels={labels}
            onChoose={chooseMonth}
            onYears={showYears}
            ids={ids}
          />
        ) : (
          <DaysPane
            month={session.month}
            chosenDay={session.parts.day}
            min={min}
            max={max}
            weekStartsOn={weekStartsOn}
            weekdays={weekdays}
            formatters={formatters}
            labels={labels}
            onMonth={showMonth}
            onYears={showYears}
            onChoose={chooseDay}
            ids={ids}
          />
        )}
        {session.pane === 'day' && mode === 'dateTime' ? (
          <View className="gap-4">
            <Text accessibilityRole="header" className="font-body-bold text-body text-heading">
              {labels.time}
            </Text>
            <TimeChoices
              label={labels.hour}
              options={HOURS}
              value={session.parts.hour}
              onChoose={chooseHour}
              testID={ids('hour')}
            />
            <TimeChoices
              label={labels.minutes}
              options={minuteOptions(minuteStep, session.parts.minute)}
              value={session.parts.minute}
              onChoose={chooseMinute}
              testID={ids('minute')}
            />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}
