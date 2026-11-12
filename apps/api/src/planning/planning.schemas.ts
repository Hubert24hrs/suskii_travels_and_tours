import { z } from 'zod';

import { named } from '../contract/contract';

const timestamp = z.iso.datetime();
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const point = z.object({ label: z.string(), lat: z.number(), lng: z.number() });

export const departurePlanQuerySchema = z.object({
  from: z.uuid().meta({ description: 'The ride place the traveller leaves from.' }),
});

export const departurePlanSchema = named(
  'DeparturePlan',
  z.object({
    kind: z.enum(['flight', 'bus']),
    departsAt: timestamp,
    destination: point.meta({ description: 'The airport or bus terminal to be at.' }),
    bufferMinutes: z
      .number()
      .int()
      .meta({ description: 'How early to be there: check-in for flights, boarding for buses.' }),
    marginMinutes: z.number().int().meta({ description: 'Allowance for traffic on the way.' }),
    arriveBy: timestamp,
    leaveBy: timestamp,
    travel: z.object({
      durationSeconds: z.number().int(),
      distanceMetres: z.number().int(),
      estimate: z.enum(['routed', 'straight_line']),
    }),
    from: point.extend({ id: z.uuid() }),
    ride: z.object({ pickup: point, dropoff: point, scheduledFor: timestamp }).nullable().meta({
      description:
        'A ride to book for `leaveBy`, while rides are on and it falls in the scheduling window.',
    }),
  }),
);
export type DeparturePlanDto = z.infer<typeof departurePlanSchema>;

export const carsSuggestionsSchema = named(
  'CarsSuggestions',
  z.object({
    ride: z
      .object({
        pickupPlaceId: z.uuid(),
        pickupLabel: z.string(),
        cityName: z.string(),
        scheduledFor: timestamp.nullable().meta({
          description:
            'Pick-up time to suggest, 30 minutes after landing; null outside the scheduling window.',
        }),
      })
      .nullable()
      .meta({ description: 'A ride from the arrival airport.' }),
    rental: z
      .object({ cityName: z.string(), pickupAtLocal: localDateTime, returnAtLocal: localDateTime })
      .nullable()
      .meta({ description: 'A car for the stay, where the fleet has cars in that city.' }),
    bus: z
      .object({ from: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .nullable()
      .meta({ description: 'Onward buses from the arrival city.' }),
  }),
);
export type CarsSuggestionsDto = z.infer<typeof carsSuggestionsSchema>;
