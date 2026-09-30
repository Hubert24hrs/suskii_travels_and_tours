/**
 * Sample in-house inventory for local development and the e2e suites (ADR-025):
 *
 *   pnpm --filter @suskii/api db:seed:demo
 *
 * Every row is marked `sample` (the apps show a "Sample" badge) and none of it is a real offer,
 * price or visa fact. Refuses to run with NODE_ENV=production: real inventory comes only from the
 * admin routes. Idempotent: products are upserted by slug and departures are only added when a
 * product has none in the future, so repeated runs do not pile up dates.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';

import { addDays, localToUtc } from '@suskii/shared';

import { PrismaClient, type Prisma } from '../src/generated/prisma/client';

const SAMPLE_NOTE = 'Sample inventory for development and testing; not a real offer.';

/** Wire money (inferred object types satisfy Prisma's Json input, interfaces would not). */
const ngn = (naira: number) => ({ amountMinor: naira * 100, currency: 'NGN' });
const prices = (adult: number, child: number | null, infant: number | null) => ({
  adult: ngn(adult),
  child: child === null ? null : ngn(child),
  infant: infant === null ? null : ngn(infant),
});

const POLICY = [
  { daysBefore: 30, refundBps: 10_000 },
  { daysBefore: 14, refundBps: 5_000 },
  { daysBefore: 0, refundBps: 0 },
];
const TOUR_POLICY = [
  { daysBefore: 2, refundBps: 10_000 },
  { daysBefore: 0, refundBps: 0 },
];

const today = (): string => new Date().toISOString().slice(0, 10);

async function city(prisma: PrismaClient, name: string, countryCode: string) {
  const row = await prisma.city.findUnique({
    where: { countryCode_name: { countryCode, name } },
  });
  if (!row) throw new Error(`city ${name} (${countryCode}) is missing: run db:seed first`);
  return row;
}

interface PackageSeed {
  slug: string;
  title: string;
  city: [string, string];
  nights: number;
  featured: boolean;
  passportRequired: boolean;
  offsets: number[];
  prices: ReturnType<typeof prices>;
  capacity: number;
}

const PACKAGES: PackageSeed[] = [
  {
    slug: 'sample-zanzibar-beach-break',
    title: 'Zanzibar beach break',
    city: ['Zanzibar', 'TZ'],
    nights: 5,
    featured: true,
    passportRequired: true,
    offsets: [45, 75, 120],
    prices: prices(1_250_000, 950_000, 150_000),
    capacity: 20,
  },
  {
    slug: 'sample-dubai-city-escape',
    title: 'Dubai city escape',
    city: ['Dubai', 'AE'],
    nights: 4,
    featured: true,
    passportRequired: true,
    offsets: [40, 70],
    prices: prices(1_650_000, 1_200_000, null),
    capacity: 16,
  },
  {
    slug: 'sample-calabar-weekend',
    title: 'Calabar weekend',
    city: ['Calabar', 'NG'],
    nights: 2,
    featured: false,
    passportRequired: false,
    offsets: [35, 63],
    prices: prices(320_000, 220_000, 0),
    capacity: 12,
  },
];

async function seedPackages(prisma: PrismaClient): Promise<void> {
  for (const seed of PACKAGES) {
    const place = await city(prisma, ...seed.city);
    const data = {
      title: seed.title,
      summary: `${seed.nights} nights in ${place.name}. ${SAMPLE_NOTE}`,
      status: 'published' as const,
      sample: true,
      featured: seed.featured,
      cityId: place.id,
      countryCode: place.countryCode,
      nights: seed.nights,
      passportRequired: seed.passportRequired,
      highlights: ['Sample highlight one', 'Sample highlight two'],
      itinerary: Array.from({ length: Math.min(seed.nights + 1, 4) }, (_, index) => ({
        day: index + 1,
        title: `Day ${index + 1}`,
        body: 'Sample itinerary text for development.',
      })),
      inclusions: ['Return flights (sample)', `${seed.nights} nights hotel (sample)`],
      exclusions: ['Visa fees', 'Travel insurance'],
      cancellationPolicy: POLICY,
    } satisfies Omit<Prisma.TravelPackageUncheckedCreateInput, 'slug'>;
    const row = await prisma.travelPackage.upsert({
      where: { slug: seed.slug },
      create: { slug: seed.slug, ...data },
      update: data,
    });
    const future = await prisma.packageDeparture.count({
      where: { packageId: row.id, startDate: { gt: new Date() } },
    });
    if (future > 0) continue;
    for (const offset of seed.offsets) {
      const start = addDays(today(), offset);
      await prisma.packageDeparture.create({
        data: {
          packageId: row.id,
          startDate: new Date(`${start}T00:00:00.000Z`),
          endDate: new Date(`${addDays(start, seed.nights)}T00:00:00.000Z`),
          capacity: seed.capacity,
          prices: seed.prices,
          currency: 'NGN',
          fromPriceMinor: BigInt(seed.prices.adult.amountMinor),
        },
      });
    }
  }
}

async function seedTours(prisma: PrismaClient): Promise<void> {
  const tours = [
    {
      slug: 'sample-lagos-city-highlights',
      title: 'Lagos city highlights',
      city: ['Lagos', 'NG'] as [string, string],
      durationMinutes: 240,
      category: 'City tour',
      time: '09:00',
      offsets: [3, 5, 10, 20, 40],
      prices: prices(45_000, 30_000, 0),
      capacity: 14,
    },
    {
      slug: 'sample-dubai-desert-evening',
      title: 'Dubai desert evening',
      city: ['Dubai', 'AE'] as [string, string],
      durationMinutes: 360,
      category: 'Outdoors',
      time: '15:30',
      offsets: [7, 14, 30],
      prices: prices(95_000, 70_000, null),
      capacity: 10,
    },
  ];
  for (const seed of tours) {
    const place = await city(prisma, ...seed.city);
    const timeZone = place.timezone ?? 'UTC';
    const data = {
      title: seed.title,
      summary: `${seed.durationMinutes / 60} hours in ${place.name}. ${SAMPLE_NOTE}`,
      status: 'published' as const,
      sample: true,
      featured: true,
      cityId: place.id,
      countryCode: place.countryCode,
      timeZone,
      durationMinutes: seed.durationMinutes,
      category: seed.category,
      meetingPoint: {
        name: 'Sample meeting point',
        address: `City centre, ${place.name}`,
        notes: 'Arrive 15 minutes early (sample).',
      },
      highlights: ['Sample stop one', 'Sample stop two'],
      inclusions: ['Guide (sample)', 'Transport (sample)'],
      exclusions: ['Meals'],
      cancellationPolicy: TOUR_POLICY,
    } satisfies Omit<Prisma.TourUncheckedCreateInput, 'slug'>;
    const row = await prisma.tour.upsert({
      where: { slug: seed.slug },
      create: { slug: seed.slug, ...data },
      update: data,
    });
    const future = await prisma.tourDeparture.count({
      where: { tourId: row.id, startsAtUtc: { gt: new Date() } },
    });
    if (future > 0) continue;
    for (const offset of seed.offsets) {
      const local = `${addDays(today(), offset)}T${seed.time}`;
      await prisma.tourDeparture.create({
        data: {
          tourId: row.id,
          startsAtLocal: local,
          startsAtUtc: localToUtc(local, timeZone),
          capacity: seed.capacity,
          prices: seed.prices,
          currency: 'NGN',
          fromPriceMinor: BigInt(seed.prices.adult.amountMinor),
        },
      });
    }
  }
}

async function seedAddons(prisma: PrismaClient): Promise<void> {
  const addons: (Omit<
    Prisma.AddonCreateInput,
    'status' | 'sample' | 'currency' | 'priceMinor' | 'price'
  > & { price: ReturnType<typeof ngn> })[] = [
    {
      slug: 'sample-travel-insurance',
      type: 'insurance',
      title: 'Travel insurance (sample)',
      summary: 'Medical and trip cover, priced per traveller per day.',
      description: SAMPLE_NOTE,
      countryCodes: [],
      pricingBasis: 'per_person_per_day',
      price: ngn(1_500),
      requiredDetails: ['dates_of_birth'],
      cancellationPolicy: [
        { daysBefore: 1, refundBps: 10_000 },
        { daysBefore: 0, refundBps: 0 },
      ],
    },
    {
      slug: 'sample-lagos-airport-transfer',
      type: 'airport_transfer',
      title: 'Lagos airport transfer (sample)',
      summary: 'Private car from Lagos airport to your address.',
      description: SAMPLE_NOTE,
      countryCodes: ['NG'],
      pricingBasis: 'per_booking',
      price: ngn(35_000),
      maxTravellers: 4,
      requiredDetails: ['flight_number', 'arrival_time', 'pickup_address'],
      cancellationPolicy: TOUR_POLICY,
    },
    {
      slug: 'sample-travel-esim',
      type: 'esim',
      title: 'Travel eSIM (sample)',
      summary: 'Mobile data abroad, priced per day.',
      description: SAMPLE_NOTE,
      countryCodes: [],
      pricingBasis: 'per_day',
      price: ngn(2_500),
      maxTravellers: 1,
      cancellationPolicy: [{ daysBefore: 0, refundBps: 0 }],
    },
  ];
  for (const seed of addons) {
    const data = {
      ...seed,
      status: 'published' as const,
      sample: true,
      currency: seed.price.currency,
      priceMinor: BigInt(seed.price.amountMinor),
    };
    await prisma.addon.upsert({ where: { slug: seed.slug }, create: data, update: data });
  }
}

async function seedVisa(prisma: PrismaClient): Promise<void> {
  const checklist = [
    {
      key: 'passport',
      label: 'Passport bio page',
      description: 'A clear scan of the photo page.',
      required: true,
    },
    {
      key: 'photo',
      label: 'Passport photo',
      description: 'Recent, plain background.',
      required: true,
    },
    {
      key: 'bank_statement',
      label: 'Bank statement',
      description: 'Last six months.',
      required: true,
    },
    {
      key: 'invitation',
      label: 'Invitation letter',
      description: 'If someone is hosting you.',
      required: false,
    },
  ];
  const products = [
    {
      slug: 'sample-uk-visitor-visa',
      title: 'UK visitor visa assistance (sample)',
      destination: 'GB',
      purposes: ['tourism', 'business'] as ('tourism' | 'business')[],
      processingDaysMin: 15,
      processingDaysMax: 30,
      price: ngn(85_000),
    },
    {
      slug: 'sample-uae-tourist-visa',
      title: 'UAE tourist visa assistance (sample)',
      destination: 'AE',
      purposes: ['tourism'] as 'tourism'[],
      processingDaysMin: 3,
      processingDaysMax: 7,
      price: ngn(45_000),
    },
  ];
  for (const seed of products) {
    const data = {
      ...seed,
      summary: SAMPLE_NOTE,
      status: 'published' as const,
      sample: true,
      currency: 'NGN',
      priceMinor: BigInt(seed.price.amountMinor),
      checklist,
      governmentFeeNote: 'Government fees are paid separately to the authority (sample note).',
    };
    await prisma.visaProduct.upsert({ where: { slug: seed.slug }, create: data, update: data });
  }
  const rules: Prisma.VisaRuleCreateInput[] = [
    { nationality: 'NG', destination: 'GB', purpose: 'tourism', requirement: 'visa_required' },
    { nationality: 'NG', destination: 'GB', purpose: 'business', requirement: 'visa_required' },
    { nationality: 'NG', destination: 'AE', purpose: 'tourism', requirement: 'e_visa' },
    { nationality: 'NG', destination: 'GH', purpose: 'tourism', requirement: 'visa_free' },
  ];
  for (const rule of rules) {
    const data = {
      ...rule,
      maxStayDays: rule.requirement === 'visa_free' ? 90 : null,
      notes: 'Sample rule for development; not verified.',
      verifiedAt: null,
      sample: true,
    };
    await prisma.visaRule.upsert({
      where: {
        nationality_destination_purpose: {
          nationality: rule.nationality,
          destination: rule.destination,
          purpose: rule.purpose,
        },
      },
      create: data,
      update: data,
    });
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:seed:demo creates sample inventory and never runs in production');
  }
  // Local runs read the repository's root .env, like prisma.config.ts; CI passes DATABASE_URL.
  const rootEnv = join(process.cwd(), '..', '..', '.env');
  if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await seedPackages(prisma);
    await seedTours(prisma);
    await seedAddons(prisma);
    await seedVisa(prisma);
    process.stdout.write('sample inventory ensured (packages, tours, add-ons, visa)\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`demo seed failed: ${(error as Error).message}\n`);
  process.exit(1);
});
