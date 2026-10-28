/**
 * Verified reviews (ADR-077): written by travellers after a trip they booked and finished with
 * Suskii, moderated before anyone sees them. Framework-agnostic, so the website's client code can
 * use it through `@suskii/shared/lite`.
 */

/** What a review is about: a hotel (matched across suppliers), or one of our catalog products. */
export const REVIEW_SUBJECT_KINDS = [
  'hotel',
  'package',
  'tour',
  'bus_operator',
  'rental_vehicle',
] as const;
export type ReviewSubjectKind = (typeof REVIEW_SUBJECT_KINDS)[number];

/** Booking item kinds a traveller can review; flights, visas, add-ons and rides cannot. */
export const REVIEWABLE_ITEM_KINDS = ['hotel', 'package', 'tour', 'bus', 'rental'] as const;
export type ReviewableItemKind = (typeof REVIEWABLE_ITEM_KINDS)[number];

export const isReviewableItemKind = (kind: string): kind is ReviewableItemKind =>
  (REVIEWABLE_ITEM_KINDS as readonly string[]).includes(kind);

export const REVIEW_TRIP_TYPES = ['solo', 'couple', 'family', 'friends', 'business'] as const;
export type ReviewTripType = (typeof REVIEW_TRIP_TYPES)[number];

export const REVIEW_STATUSES = ['pending', 'published', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Why a moderator rejected a review; codes only, so no text lands in the record. */
export const REVIEW_REJECT_REASONS = [
  'personal_data',
  'offensive',
  'off_topic',
  'spam',
  'conflict_of_interest',
  'unlawful',
] as const;
export type ReviewRejectReason = (typeof REVIEW_REJECT_REASONS)[number];

/** What the automatic check found in a review's text, for the moderator's attention. */
export const REVIEW_FLAGS = ['contact_details', 'link'] as const;
export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

/** Whole numbers from 1 to 10, the scale hotel scores already use. */
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 10;
export const REVIEW_TITLE_MAX = 100;
export const REVIEW_TEXT_MAX = 1000;
/** Published reviews per page in public lists. */
export const REVIEW_PAGE_SIZE = 10;

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/u;
// Seven or more digits, allowing spaces, dots, dashes and brackets between them (phone numbers).
const PHONE = /(?:\+?\d[\s().-]*){7,}/u;
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[\p{L}\p{N}-]+\.(?:com|net|org|ng|io|co|info|biz)\b/iu;

/** Contact details and links in a review's texts: flagged for the moderator, never removed. */
export function reviewFlags(texts: readonly (string | null | undefined)[]): ReviewFlag[] {
  const text = texts.filter((value): value is string => typeof value === 'string').join('\n');
  const flags: ReviewFlag[] = [];
  if (EMAIL.test(text) || PHONE.test(text)) flags.push('contact_details');
  // An email's domain is not a link.
  if (LINK.test(text.replace(new RegExp(EMAIL.source, 'gu'), ' '))) flags.push('link');
  return flags;
}

/** The average of published ratings to one decimal, or null when there are none. */
export function reviewScore(ratingSum: number, ratingCount: number): number | null {
  if (ratingCount <= 0) return null;
  return Math.round((ratingSum / ratingCount) * 10) / 10;
}

/** "Ada O.": the lead traveller's first name and last initial, as shown under a review. */
export function reviewDisplayName(givenName: string, familyName: string): string {
  const first = givenName.trim().split(/\s+/)[0] ?? '';
  const initial = familyName.trim().charAt(0).toLocaleUpperCase();
  return initial ? `${first} ${initial}.` : first;
}
