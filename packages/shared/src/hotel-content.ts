/**
 * What kind of place a property is (ADR-096). Suppliers name these in many ways; adapters map
 * to this list and leave the type out when they cannot tell.
 */
export const PROPERTY_TYPES = [
  'hotel',
  'apartment',
  'resort',
  'guesthouse',
  'villa',
  'hostel',
  'lodge',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** Beds as rooms list them. */
export const BED_TYPES = ['single', 'twin', 'double', 'queen', 'king', 'sofa_bed', 'bunk'] as const;
export type BedType = (typeof BED_TYPES)[number];

/** Photos kept per hotel and per room, and the length of a description shown to travellers. */
export const MAX_HOTEL_PHOTOS = 12;
export const MAX_ROOM_PHOTOS = 4;
export const HOTEL_DESCRIPTION_MAX = 1200;
export const ROOM_DESCRIPTION_MAX = 400;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * A supplier's description as plain text: markup and its common entities out, whitespace
 * collapsed, and cut at the last sentence that fits `max` (or at a word, with an ellipsis).
 * Clients render the result as text, never as HTML.
 */
export function plainDescription(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const text = value
    .replace(/<(br|\/p|\/li|\/h[1-6])\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITIES[entity] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence >= max / 2) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(' ');
  return `${cut.slice(0, word > 0 ? word : max).replace(/[,;:.\s]+$/, '')}…`;
}

// A dotted host name, an optional port and a path: no credentials, no spaces, quotes or brackets.
const PHOTO_URL =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{1,5})?(?:\/[^\s"'<>\\]*)?$/i;

/**
 * Whether a photo URL from a supplier may be handed to clients: https, a host name, no
 * credentials, and no longer than a URL has reason to be.
 */
export function isSafePhotoUrl(value: unknown): boolean {
  return typeof value === 'string' && value.length <= 600 && PHOTO_URL.test(value);
}
