import { countryCodeSchema } from './country-code';
import { iataCodeSchema, isoDateSchema } from './search';
import { daysBetween } from './time';
import {
  TRIP_COMPONENTS,
  TRIP_MAX_ADULTS,
  TRIP_MAX_CHILDREN,
  TRIP_MAX_NIGHTS,
  type TripPlan,
} from './trips';
import { z } from './zod-setup';

/** Why a trip plan is refused (`issues[].message`). */
export const TRIP_PLAN_ISSUES = {
  samePlace: 'same_place',
  returnBeforeDeparture: 'return_before_departure',
  tooLong: 'too_long',
  duplicateComponent: 'duplicate_component',
} as const;

const placeName = z.string().trim().min(1).max(120);
const place = z.object({
  code: iataCodeSchema,
  name: placeName,
  cityName: placeName.nullable(),
  countryCode: countryCodeSchema,
});

/** What a traveller asks a trip for (ADR-099): places, dates, head counts and the parts wanted. */
export const tripPlanSchema = z
  .object({
    origin: place,
    destination: place.extend({ cityId: z.uuid().nullable() }),
    departDate: isoDateSchema,
    returnDate: isoDateSchema,
    adults: z.number().int().min(1).max(TRIP_MAX_ADULTS),
    children: z.number().int().min(0).max(TRIP_MAX_CHILDREN).default(0),
    components: z.array(z.enum(TRIP_COMPONENTS)).min(1).max(TRIP_COMPONENTS.length),
  })
  .superRefine((plan, context) => {
    const report = (path: string, message: string): void => {
      context.addIssue({ code: 'custom', path: [path], message });
    };
    if (plan.origin.code === plan.destination.code) {
      report('destination', TRIP_PLAN_ISSUES.samePlace);
    }
    const nights = daysBetween(plan.departDate, plan.returnDate);
    if (nights < 1) report('returnDate', TRIP_PLAN_ISSUES.returnBeforeDeparture);
    else if (nights > TRIP_MAX_NIGHTS) report('returnDate', TRIP_PLAN_ISSUES.tooLong);
    if (new Set(plan.components).size !== plan.components.length) {
      report('components', TRIP_PLAN_ISSUES.duplicateComponent);
    }
  }) satisfies z.ZodType<TripPlan, unknown>;
