import * as z from 'zod';

/** Product verticals. Values are stable identifiers used in URLs, analytics and the database. */
export const VERTICALS = [
  'flights',
  'hotels',
  'packages',
  'tours',
  'visa',
  'travel_addons',
] as const;

export type Vertical = (typeof VERTICALS)[number];

export const verticalSchema = z.enum(VERTICALS);

export function isVertical(value: string): value is Vertical {
  return (VERTICALS as readonly string[]).includes(value);
}
