import { z } from './zod-setup';

import { emailSchema, phoneSchema } from './auth';
import { countryCodeSchema } from './country-code';
import {
  FULL_NAME_MAX_LENGTH,
  GENDERS,
  MEAL_REQUESTS,
  NAME_MAX_LENGTH,
  PASSENGER_ISSUES,
  PASSENGER_TITLES,
  PASSENGER_TYPES,
  transliterateName,
} from './passenger-rules';
import { isoDateSchema } from './search';

/** A name normalised to its passport (machine-readable) form; see `transliterateName`. */
export const personNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((value, ctx) => {
    const name = transliterateName(value);
    if (!name) {
      ctx.addIssue({ code: 'custom', message: PASSENGER_ISSUES.nameNotLatin });
      return z.NEVER;
    }
    if (name.length > NAME_MAX_LENGTH) {
      ctx.addIssue({ code: 'custom', message: PASSENGER_ISSUES.nameTooLong });
      return z.NEVER;
    }
    return name;
  });

/** Spaces and hyphens removed, upper case, 5-20 letters or digits. */
export const passportNumberSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{5,20}$/, 'Enter the passport number as printed'));

export const travelDocumentSchema = z.object({
  number: passportNumberSchema,
  issuingCountry: countryCodeSchema,
  expiryDate: isoDateSchema,
});
export type TravelDocument = z.output<typeof travelDocumentSchema>;

const personShape = {
  title: z.enum(PASSENGER_TITLES),
  gender: z.enum(GENDERS),
  givenNames: personNameSchema,
  surname: personNameSchema,
  dateOfBirth: isoDateSchema,
  nationality: countryCodeSchema,
};

const fullNameFits = (person: { givenNames: string; surname: string }) =>
  person.givenNames.length + person.surname.length <= FULL_NAME_MAX_LENGTH;
const fullNameIssue = { message: PASSENGER_ISSUES.nameTooLong, path: ['surname'] };

/**
 * A flight passenger at checkout. With `travellerId`, the passport number may be left out: the
 * saved traveller's stored number is used, so it never travels back to the browser.
 */
export const passengerInputSchema = z
  .object({
    type: z.enum(PASSENGER_TYPES),
    ...personShape,
    document: travelDocumentSchema
      .extend({ number: passportNumberSchema.nullable().default(null) })
      .nullable()
      .default(null),
    travellerId: z.uuid().nullable().default(null),
    saveTraveller: z.boolean().default(false),
    /** A special meal to ask the airline for; only on fares whose supplier passes requests on. */
    meal: z.enum(MEAL_REQUESTS).nullable().default(null),
  })
  .refine(fullNameFits, fullNameIssue)
  .refine(
    // Lap infants have no meal service of their own; the child's meal is for children.
    (passenger) =>
      passenger.meal === null ||
      (passenger.type !== 'infant' && (passenger.meal !== 'child' || passenger.type === 'child')),
    { message: PASSENGER_ISSUES.mealNotForPassenger, path: ['meal'] },
  )
  .refine(
    // No document at all is fine here (checkPassengers decides whether one is required).
    (passenger) => passenger.document?.number !== null || passenger.travellerId !== null,
    {
      message: PASSENGER_ISSUES.documentRequired,
      path: ['document', 'number'],
    },
  );
export type PassengerInput = z.output<typeof passengerInputSchema>;

/**
 * A saved traveller (account holders keep up to MAX_SAVED_TRAVELLERS). On update, a document
 * without a number keeps the stored passport number (clients only ever see it masked).
 */
export const travellerInputSchema = z
  .object({
    ...personShape,
    document: travelDocumentSchema
      .extend({ number: passportNumberSchema.nullable().default(null) })
      .nullable()
      .default(null),
  })
  .refine(fullNameFits, fullNameIssue);
export type TravellerInput = z.output<typeof travellerInputSchema>;

/** Lead guest for one hotel room. */
export const hotelGuestSchema = z
  .object({ givenNames: personNameSchema, surname: personNameSchema })
  .refine(fullNameFits, fullNameIssue);
export type HotelGuest = z.output<typeof hotelGuestSchema>;

export const contactDetailsSchema = z.object({ email: emailSchema, phone: phoneSchema });
export type ContactDetails = z.output<typeof contactDetailsSchema>;

/** Many countries ask for a passport valid this many months after arrival. */
export const PASSPORT_VALIDITY_MONTHS = 6;

export type PassportValidity = 'valid' | 'expires_soon' | 'expired';

/**
 * Whether a passport expiring on `expiryDate` lasts `months` past `arrivalDate` (both ISO
 * dates). `expired` when it has run out by arrival, `expires_soon` when it runs out within the
 * months asked, else `valid`. A reminder for the traveller, never a decision about entry: the
 * destination's own rule decides, and it differs by country.
 */
export function passportValidity(
  expiryDate: string,
  arrivalDate: string,
  months: number = PASSPORT_VALIDITY_MONTHS,
): PassportValidity {
  if (expiryDate < arrivalDate) return 'expired';
  const [year = 0, month = 1, day = 1] = arrivalDate.split('-').map(Number);
  // The same day `months` later; a day that month does not have rolls into the next one.
  const needed = new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
  return expiryDate < needed ? 'expires_soon' : 'valid';
}
