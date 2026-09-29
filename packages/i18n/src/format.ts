import {
  formatMoney,
  fromWire,
  roundDiv,
  currencyExponent,
  type Money,
  type MoneyWire,
} from '@suskii/shared/lite';

export type DateStyle = 'short' | 'medium' | 'long' | 'weekday';

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: 'numeric', month: 'short' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  weekday: { weekday: 'short', day: 'numeric', month: 'short' },
};

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** Calendar dates ("YYYY-MM-DD") are formatted in UTC so they never shift a day. */
const calendarDate = (value: string): Date => new Date(`${value.slice(0, 10)}T00:00:00Z`);

export interface Formatters {
  readonly locale: string;
  /** Exact amount with the currency's minor digits (hidden when the amount is whole). */
  money(amount: Money | MoneyWire): string;
  /**
   * Headline "from" prices: rounded **up** to whole units, so the figure shown is never below
   * what the customer pays.
   */
  moneyFrom(amount: Money | MoneyWire): string;
  date(value: string, style?: DateStyle): string;
  dateRange(start: string, end: string, style?: DateStyle): string;
  /** "2 hours ago", "yesterday"; `now` is injectable for tests and stable server renders. */
  relativeTime(instant: string | Date, now?: Date): string;
  number(value: number): string;
  list(items: readonly string[]): string;
}

const toMoney = (amount: Money | MoneyWire): Money =>
  'minor' in amount ? amount : fromWire(amount);

export function createFormatters(locale: string): Formatters {
  const dateFormats = new Map<DateStyle, Intl.DateTimeFormat>();
  const dateFormat = (style: DateStyle): Intl.DateTimeFormat => {
    let format = dateFormats.get(style);
    if (!format) {
      format = new Intl.DateTimeFormat(locale, { ...DATE_OPTIONS[style], timeZone: 'UTC' });
      dateFormats.set(style, format);
    }
    return format;
  };
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const numbers = new Intl.NumberFormat(locale);
  const lists = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });

  return {
    locale,
    money: (amount) => formatMoney(toMoney(amount), locale, { hideZeroDecimals: true }),
    moneyFrom(amount) {
      const value = toMoney(amount);
      const unit = 10n ** BigInt(currencyExponent(value.currency));
      const whole = roundDiv(value.minor, unit, 'ceil') * unit;
      return formatMoney({ minor: whole, currency: value.currency }, locale, {
        hideZeroDecimals: true,
      });
    },
    date: (value, style = 'medium') => dateFormat(style).format(calendarDate(value)),
    dateRange: (start, end, style = 'short') =>
      dateFormat(style).formatRange(calendarDate(start), calendarDate(end)),
    relativeTime(instant, now = new Date()) {
      const seconds = Math.round(
        ((typeof instant === 'string' ? Date.parse(instant) : instant.getTime()) - now.getTime()) /
          1000,
      );
      for (const [unit, size] of RELATIVE_UNITS) {
        if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit);
      }
      return relative.format(0, 'minute');
    },
    number: (value) => numbers.format(value),
    list: (items) => lists.format(items),
  };
}
