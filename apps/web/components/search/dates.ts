/** Calendar dates ("YYYY-MM-DD") <-> local Date objects for the day picker. */
export function isoToDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function dateToIso(date: Date | undefined): string {
  if (!date) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today in the visitor's time zone: the earliest selectable day. */
export function localToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Weeks start on Monday in Nigeria and the UK, on Sunday in the US. */
export const weekStartsOn = (locale: string): 0 | 1 => (locale === 'en-US' ? 0 : 1);
