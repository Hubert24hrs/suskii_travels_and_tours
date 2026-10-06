import { z } from 'zod';

import { named } from '../contract/contract';

const timestamp = z.iso.datetime();
const slug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .meta({ description: 'Lower-case words joined by hyphens, e.g. lagos-to-london.' });
const iata = z.string().regex(/^[A-Z]{3}$/);
const sortOrder = z.number().int().min(0).max(10_000);

const dealRouteFields = z.object({
  slug,
  originCode: iata,
  destinationCode: iata,
  cabinClass: z.enum(['economy', 'premium_economy', 'business', 'first']),
  stayNights: z.number().int().min(1).max(60),
  active: z.boolean(),
  sortOrder,
});
export type DealRouteFields = z.infer<typeof dealRouteFields>;

const differentAirports = (value: DealRouteFields, ctx: z.RefinementCtx): void => {
  if (value.originCode === value.destinationCode) {
    ctx.addIssue({ code: 'custom', path: ['destinationCode'], message: 'same_as_origin' });
  }
};

export const dealRouteInputSchema = named(
  'DealRouteInput',
  dealRouteFields.superRefine(differentAirports),
);
export const dealRoutePatchSchema = named('DealRoutePatch', dealRouteFields.partial());
export const dealRouteCheck = dealRouteFields.superRefine(differentAirports);

export const adminDealRouteSchema = named(
  'AdminDealRoute',
  dealRouteFields.extend({
    id: z.uuid(),
    lastRefreshedAt: timestamp
      .nullable()
      .meta({ description: 'When the deals worker last found a fare for this route.' }),
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
);
export const adminDealRouteListSchema = named(
  'AdminDealRouteList',
  z.object({ routes: z.array(adminDealRouteSchema) }),
);

const destinationFields = z.object({
  cityId: z.uuid(),
  slug,
  featured: z.boolean().meta({ description: 'Shown on the homepage while published.' }),
  sortOrder,
  imageUrl: z
    .url({ protocol: /^https$/ })
    .max(500)
    .nullable()
    .meta({ description: 'Licensed photo (https); the web shows an illustration while empty.' }),
  published: z.boolean(),
});
export type DestinationFields = z.infer<typeof destinationFields>;

export const destinationInputSchema = named('DestinationInput', destinationFields);
export const destinationPatchSchema = named(
  'DestinationPatch',
  destinationFields.omit({ cityId: true }).partial(),
);

export const adminDestinationSchema = named(
  'AdminDestination',
  destinationFields.extend({
    id: z.uuid(),
    cityName: z.string(),
    countryCode: z.string(),
    publishedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
);
export const adminDestinationListSchema = named(
  'AdminDestinationList',
  z.object({ destinations: z.array(adminDestinationSchema) }),
);

export const adminIdParamsSchema = z.object({ id: z.uuid() });
