import * as z from 'zod';

import {
  currencyCodeSchema,
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
} from './currency';
import { MAX_ADVANCE_DAYS, SEARCH_ISSUES, isoDateSchema, type SearchSchemaOptions } from './search';
import { QueryBuilder, queryReaders, type ParsedSearch, type QueryInput } from './search-url';
import { addDays, earliestToday } from './time';
import { DEFAULT_TRAVELLERS, travellerCountsSchema, type TravellerCounts } from './travellers';

/**
 * Homepage forms for packages, tours, visa and travel add-ons
 * (PROJECT_SPEC.json#/homepage_spec search_module). Each validates with its schema and routes to
 * its vertical page with the query in the URL; listings and the visa eligibility check arrive
 * with the inventory in phase 8.
 */

const { first, date, oneOf, readTravellers, appendTravellers } = queryReaders;

export const VERTICAL_FORM_ISSUES = {
  endBeforeStart: 'end_before_start',
  monthInPast: 'month_in_past',
  budgetMinAboveMax: 'budget_min_above_max',
  sameNationalityDestination: 'same_nationality_destination',
} as const;

const cityIdSchema = z.uuid();
const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'Use a 2-letter country code');
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: string): string => (UUID_PATTERN.test(value) ? value.toLowerCase() : '');
const country = (value: string): string => (/^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : '');

type IssueSink = (path: (string | number)[], message: string) => void;

/** A date that must fall between today (earliest time zone) and the booking horizon. */
function checkUpcoming(
  value: string,
  now: Date,
  path: (string | number)[],
  report: IssueSink,
): void {
  const today = earliestToday(now);
  if (value < today) report(path, SEARCH_ISSUES.dateInPast);
  else if (value > addDays(today, MAX_ADVANCE_DAYS)) report(path, SEARCH_ISSUES.dateTooFar);
}

// ---------------------------------------------------------------------------
// Packages: destination, month or date range, travellers, budget range
// ---------------------------------------------------------------------------

const packagesFormSchemaShape = {
  cityId: cityIdSchema,
  when: z.discriminatedUnion('type', [
    z.object({ type: z.literal('month'), month: monthSchema }),
    z.object({ type: z.literal('dates'), from: isoDateSchema, to: isoDateSchema }),
  ]),
  travellers: travellerCountsSchema,
  /** Whole major units per person (e.g. naira), optional on either side. */
  budget: z.object({
    currency: currencyCodeSchema,
    min: z.number().int().min(0).max(1_000_000_000).nullable(),
    max: z.number().int().min(1).max(1_000_000_000).nullable(),
  }),
};

export function createPackagesFormSchema(options: SearchSchemaOptions = {}) {
  const now = options.now ?? (() => new Date());
  return z.object(packagesFormSchemaShape).superRefine((form, ctx) => {
    const report: IssueSink = (path, message) => ctx.addIssue({ code: 'custom', path, message });
    const today = earliestToday(now());
    if (form.when.type === 'month') {
      if (form.when.month < today.slice(0, 7))
        report(['when', 'month'], VERTICAL_FORM_ISSUES.monthInPast);
    } else {
      checkUpcoming(form.when.from, now(), ['when', 'from'], report);
      if (form.when.to < form.when.from)
        report(['when', 'to'], VERTICAL_FORM_ISSUES.endBeforeStart);
    }
    const { min, max } = form.budget;
    if (min !== null && max !== null && min > max) {
      report(['budget', 'max'], VERTICAL_FORM_ISSUES.budgetMinAboveMax);
    }
  });
}
export const packagesFormSchema = createPackagesFormSchema();
export type PackagesForm = z.output<typeof packagesFormSchema>;

export interface PackagesFormDraft {
  cityId: string;
  whenType: 'month' | 'dates';
  month: string;
  from: string;
  to: string;
  travellers: TravellerCounts;
  budgetCurrency: CurrencyCode;
  budgetMin: number | null;
  budgetMax: number | null;
}

export function emptyPackagesDraft(currency: CurrencyCode = DEFAULT_CURRENCY): PackagesFormDraft {
  return {
    cityId: '',
    whenType: 'month',
    month: '',
    from: '',
    to: '',
    travellers: { ...DEFAULT_TRAVELLERS, adults: 2 },
    budgetCurrency: currency,
    budgetMin: null,
    budgetMax: null,
  };
}

export function packagesDraftToInput(draft: PackagesFormDraft): unknown {
  return {
    cityId: draft.cityId,
    when:
      draft.whenType === 'month'
        ? { type: 'month', month: draft.month }
        : { type: 'dates', from: draft.from, to: draft.to },
    travellers: draft.travellers,
    budget: { currency: draft.budgetCurrency, min: draft.budgetMin, max: draft.budgetMax },
  };
}

export function packagesFormToParams(form: PackagesForm): QueryBuilder {
  const params = new QueryBuilder().set('dest', form.cityId);
  if (form.when.type === 'month') params.set('month', form.when.month);
  else {
    params.set('from', form.when.from);
    params.set('to', form.when.to);
  }
  appendTravellers(params, form.travellers);
  const { min, max, currency } = form.budget;
  if (min !== null || max !== null) {
    params.set('budget', `${min ?? ''}-${max ?? ''}`);
    params.set('cur', currency);
  }
  return params;
}

const budgetBound = (value: string | undefined): number | null =>
  value && /^\d{1,10}$/.test(value) ? Number(value) : null;

export function parsePackagesParams(
  query: QueryInput,
  options: SearchSchemaOptions = {},
): ParsedSearch<PackagesFormDraft, PackagesForm> {
  const month = first(query, 'month');
  const [minRaw, maxRaw] = first(query, 'budget').split('-');
  const draft: PackagesFormDraft = {
    cityId: uuid(first(query, 'dest')),
    whenType: first(query, 'from') ? 'dates' : 'month',
    month: /^\d{4}-\d{2}$/.test(month) ? month : '',
    from: date(first(query, 'from')),
    to: date(first(query, 'to')),
    travellers: readTravellers(query),
    budgetCurrency: oneOf(SUPPORTED_CURRENCIES, first(query, 'cur'), DEFAULT_CURRENCY),
    budgetMin: budgetBound(minRaw),
    budgetMax: budgetBound(maxRaw),
  };
  const result = createPackagesFormSchema(options).safeParse(packagesDraftToInput(draft));
  return { draft, form: result.success ? result.data : null };
}

// ---------------------------------------------------------------------------
// Tours: destination or keyword, date, travellers
// ---------------------------------------------------------------------------

export function createToursFormSchema(options: SearchSchemaOptions = {}) {
  const now = options.now ?? (() => new Date());
  return z
    .object({
      query: z.string().trim().min(2).max(64),
      date: isoDateSchema,
      travellers: travellerCountsSchema,
    })
    .superRefine((form, ctx) => {
      checkUpcoming(form.date, now(), ['date'], (path, message) =>
        ctx.addIssue({ code: 'custom', path, message }),
      );
    });
}
export const toursFormSchema = createToursFormSchema();
export type ToursForm = z.output<typeof toursFormSchema>;

export interface ToursFormDraft {
  query: string;
  date: string;
  travellers: TravellerCounts;
}

export function emptyToursDraft(): ToursFormDraft {
  return { query: '', date: '', travellers: { ...DEFAULT_TRAVELLERS, adults: 2 } };
}

export function toursFormToParams(form: ToursForm): QueryBuilder {
  const params = new QueryBuilder().set('q', form.query).set('date', form.date);
  appendTravellers(params, form.travellers);
  return params;
}

export function parseToursParams(
  query: QueryInput,
  options: SearchSchemaOptions = {},
): ParsedSearch<ToursFormDraft, ToursForm> {
  const draft: ToursFormDraft = {
    query: first(query, 'q').slice(0, 64),
    date: date(first(query, 'date')),
    travellers: readTravellers(query),
  };
  const result = createToursFormSchema(options).safeParse(draft);
  return { draft, form: result.success ? result.data : null };
}

// ---------------------------------------------------------------------------
// Visa: nationality, destination country, purpose, travel date
// ---------------------------------------------------------------------------

export const VISA_PURPOSES = ['tourism', 'business', 'study', 'transit'] as const;
export type VisaPurpose = (typeof VISA_PURPOSES)[number];

export function createVisaFormSchema(options: SearchSchemaOptions = {}) {
  const now = options.now ?? (() => new Date());
  return z
    .object({
      nationality: countryCodeSchema,
      destination: countryCodeSchema,
      purpose: z.enum(VISA_PURPOSES),
      travelDate: isoDateSchema,
    })
    .superRefine((form, ctx) => {
      const report: IssueSink = (path, message) => ctx.addIssue({ code: 'custom', path, message });
      if (form.nationality === form.destination) {
        report(['destination'], VERTICAL_FORM_ISSUES.sameNationalityDestination);
      }
      checkUpcoming(form.travelDate, now(), ['travelDate'], report);
    });
}
export const visaFormSchema = createVisaFormSchema();
export type VisaForm = z.output<typeof visaFormSchema>;

export interface VisaFormDraft {
  nationality: string;
  destination: string;
  purpose: VisaPurpose;
  travelDate: string;
}

export function emptyVisaDraft(nationality = ''): VisaFormDraft {
  return { nationality, destination: '', purpose: 'tourism', travelDate: '' };
}

export function visaFormToParams(form: VisaForm): QueryBuilder {
  return new QueryBuilder()
    .set('nationality', form.nationality)
    .set('destination', form.destination)
    .set('purpose', form.purpose)
    .set('date', form.travelDate);
}

export function parseVisaParams(
  query: QueryInput,
  options: SearchSchemaOptions = {},
): ParsedSearch<VisaFormDraft, VisaForm> {
  const draft: VisaFormDraft = {
    nationality: country(first(query, 'nationality')),
    destination: country(first(query, 'destination')),
    purpose: oneOf(VISA_PURPOSES, first(query, 'purpose'), 'tourism'),
    travelDate: date(first(query, 'date')),
  };
  const result = createVisaFormSchema(options).safeParse(draft);
  return { draft, form: result.success ? result.data : null };
}

// ---------------------------------------------------------------------------
// Travel add-ons: standalone, or attached to an existing booking
// ---------------------------------------------------------------------------

export const ADDON_TYPES = [
  'insurance',
  'airport_transfer',
  'esim',
  'lounge',
  'extra_baggage',
] as const;
export type AddonType = (typeof ADDON_TYPES)[number];

/** Short booking reference (like an airline PNR); generated by bookings in phase 5. */
export const bookingReferenceSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6,8}$/, 'Use the 6-8 character booking reference');

export const lastNameSchema = z.string().trim().min(1).max(60);

export function createAddonsFormSchema(options: SearchSchemaOptions = {}) {
  const now = options.now ?? (() => new Date());
  return z
    .discriminatedUnion('mode', [
      z.object({
        mode: z.literal('standalone'),
        type: z.enum(ADDON_TYPES),
        cityId: cityIdSchema,
        startDate: isoDateSchema,
        endDate: isoDateSchema,
        travellers: travellerCountsSchema,
      }),
      z.object({
        mode: z.literal('booking'),
        bookingReference: bookingReferenceSchema,
        lastName: lastNameSchema,
      }),
    ])
    .superRefine((form, ctx) => {
      if (form.mode !== 'standalone') return;
      const report: IssueSink = (path, message) => ctx.addIssue({ code: 'custom', path, message });
      checkUpcoming(form.startDate, now(), ['startDate'], report);
      if (form.endDate < form.startDate) report(['endDate'], VERTICAL_FORM_ISSUES.endBeforeStart);
    });
}
export const addonsFormSchema = createAddonsFormSchema();
export type AddonsForm = z.output<typeof addonsFormSchema>;

export interface AddonsFormDraft {
  mode: 'standalone' | 'booking';
  type: AddonType;
  cityId: string;
  startDate: string;
  endDate: string;
  travellers: TravellerCounts;
  bookingReference: string;
  lastName: string;
}

export function emptyAddonsDraft(): AddonsFormDraft {
  return {
    mode: 'standalone',
    type: 'insurance',
    cityId: '',
    startDate: '',
    endDate: '',
    travellers: DEFAULT_TRAVELLERS,
    bookingReference: '',
    lastName: '',
  };
}

export function addonsDraftToInput(draft: AddonsFormDraft): unknown {
  return draft.mode === 'booking'
    ? { mode: 'booking', bookingReference: draft.bookingReference, lastName: draft.lastName }
    : {
        mode: 'standalone',
        type: draft.type,
        cityId: draft.cityId,
        startDate: draft.startDate,
        endDate: draft.endDate,
        travellers: draft.travellers,
      };
}

/** The last name is personal data and never goes into a URL; only the reference does. */
export function addonsFormToParams(form: AddonsForm): QueryBuilder {
  if (form.mode === 'booking') return new QueryBuilder().set('booking', form.bookingReference);
  const params = new QueryBuilder()
    .set('type', form.type)
    .set('dest', form.cityId)
    .set('start', form.startDate)
    .set('end', form.endDate);
  appendTravellers(params, form.travellers);
  return params;
}

export function parseAddonsParams(query: QueryInput): AddonsFormDraft {
  const booking = first(query, 'booking').toUpperCase();
  const base = emptyAddonsDraft();
  if (/^[A-Z0-9]{6,8}$/.test(booking))
    return { ...base, mode: 'booking', bookingReference: booking };
  return {
    ...base,
    type: oneOf(ADDON_TYPES, first(query, 'type'), 'insurance'),
    cityId: uuid(first(query, 'dest')),
    startDate: date(first(query, 'start')),
    endDate: date(first(query, 'end')),
    travellers: readTravellers(query),
  };
}
