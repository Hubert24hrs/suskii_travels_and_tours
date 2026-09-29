/**
 * Seeds reference data and starter content. Idempotent: safe to run on every deploy.
 *
 *   pnpm --filter @suskii/api db:seed
 *
 * - Countries, airports and derived cities from prisma/data (OurAirports, public domain).
 * - Roles and permissions from the code catalog in @suskii/shared.
 * - The five trust signals from the brand guardrails. Created once, never overwritten, so admin
 *   verification decisions survive re-seeding. Only three are verified; the traveller count and
 *   IATA accreditation stay hidden until the business provides evidence.
 * - Homepage CMS blocks and FAQs with the spec copy (published). Business facts (Prime price,
 *   support contacts, social and app store links) are left empty; the web hides them until set.
 * - Starter deal routes and featured hotel destinations from the homepage spec (ADR-011).
 * - Optional local super admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (never in production).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { parse } from 'csv-parse/sync';

import { emailSchema, passwordSchema } from '@suskii/shared';

import { airportSearchText, citySearchText } from '../src/catalog/search-text';
import { PrismaClient, type AirportType, type Prisma } from '../src/generated/prisma/client';
import { syncRbacCatalog } from '../src/rbac/rbac-catalog';

const DATA_DIR = join(__dirname, 'data');
const BATCH = 500;

interface CountryCsv {
  code: string;
  name: string;
  continent: string;
}

interface AirportCsv {
  iata_code: string;
  icao_code: string;
  name: string;
  type: AirportType;
  municipality: string;
  country_code: string;
  latitude: string;
  longitude: string;
  timezone: string;
}

const readCsv = <T>(file: string): T[] =>
  parse<T>(readFileSync(join(DATA_DIR, file), 'utf8'), { columns: true, skip_empty_lines: true });

/**
 * OurAirports municipalities sometimes carry a locality suffix, e.g. "Paris (Roissy-en-France,
 * Val-d'Oise)" for CDG; dropping it groups CDG and ORY under one "Paris".
 */
const cityName = (municipality: string): string => municipality.replace(/\s*\(.*\)\s*$/, '').trim();

const chunks = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  const countries = readCsv<CountryCsv>('countries.csv');
  for (const batch of chunks(countries, BATCH)) {
    await prisma.$transaction(
      batch.map((country) =>
        prisma.country.upsert({
          where: { code: country.code },
          create: { code: country.code, name: country.name, continent: country.continent },
          update: { name: country.name, continent: country.continent },
        }),
      ),
    );
  }

  const airports = readCsv<AirportCsv>('airports.csv');
  // One city per (country, municipality); its location and zone come from its largest airport.
  const rank: Record<AirportType, number> = {
    large_airport: 0,
    medium_airport: 1,
    small_airport: 2,
  };
  const cityByKey = new Map<string, AirportCsv>();
  for (const airport of airports) {
    if (!airport.municipality) continue;
    const key = `${airport.country_code}|${cityName(airport.municipality)}`;
    const current = cityByKey.get(key);
    if (!current || rank[airport.type] < rank[current.type]) cityByKey.set(key, airport);
  }
  await prisma.city.createMany({
    data: [...cityByKey.values()].map((airport) => ({
      name: cityName(airport.municipality),
      countryCode: airport.country_code,
      latitude: Number(airport.latitude),
      longitude: Number(airport.longitude),
      timezone: airport.timezone,
    })),
    skipDuplicates: true,
  });
  const countryName = new Map(countries.map((country) => [country.code, country.name]));
  const cities = await prisma.city.findMany({
    select: { id: true, name: true, countryCode: true },
  });
  const cityId = new Map(cities.map((city) => [`${city.countryCode}|${city.name}`, city.id]));
  // Autocomplete text for every city in one statement.
  const citySearchTexts = cities.map((city) =>
    citySearchText({ name: city.name, countryName: countryName.get(city.countryCode) ?? '' }),
  );
  await prisma.$executeRaw`
    UPDATE cities AS c SET search_text = v.search_text
    FROM unnest(${cities.map((city) => city.id)}::uuid[], ${citySearchTexts}::text[]) AS v(id, search_text)
    WHERE c.id = v.id`;

  for (const batch of chunks(airports, BATCH)) {
    await prisma.$transaction(
      batch.map((airport) => {
        const data = {
          icaoCode: airport.icao_code || null,
          name: airport.name,
          type: airport.type,
          municipality: airport.municipality || null,
          cityId: airport.municipality
            ? (cityId.get(`${airport.country_code}|${cityName(airport.municipality)}`) ?? null)
            : null,
          countryCode: airport.country_code,
          latitude: Number(airport.latitude),
          longitude: Number(airport.longitude),
          timezone: airport.timezone,
          scheduledService: true,
          searchText: airportSearchText({
            iataCode: airport.iata_code,
            name: airport.name,
            municipality: airport.municipality || null,
            countryName: countryName.get(airport.country_code) ?? '',
          }),
        };
        return prisma.airport.upsert({
          where: { iataCode: airport.iata_code },
          create: { iataCode: airport.iata_code, ...data },
          update: data,
        });
      }),
    );
  }
  process.stdout.write(
    `reference data: ${countries.length} countries, ${cityByKey.size} cities, ${airports.length} airports\n`,
  );
}

/** Exactly the list in PROJECT_SPEC.json#/brand_and_compliance_guardrails. */
const TRUST_SIGNALS: Prisma.TrustSignalCreateInput[] = [
  { key: 'support_24_7', label: '24/7 support', verified: true, sortOrder: 10 },
  {
    key: 'flexible_payment',
    label: 'Flexible payment on every booking',
    verified: true,
    sortOrder: 20,
  },
  { key: 'secure_payments', label: 'Secure payments', verified: true, sortOrder: 30 },
  {
    key: 'travellers_served',
    label: 'Travellers served',
    value: '2M+',
    verified: false,
    sortOrder: 40,
  },
  { key: 'iata_accredited', label: 'IATA accredited', verified: false, sortOrder: 50 },
];

/** Copy from the homepage spec; prices and business facts are left for the owner. */
const CMS_BLOCKS: { key: string; content: Prisma.InputJsonObject }[] = [
  {
    key: 'home.hero',
    content: {
      headline: 'Your one-stop travel shop',
      subheadline:
        'Cheap flights, great hotels, holiday packages and visa support, all in one place, with flexible payment on every booking.',
    },
  },
  {
    key: 'home.prime',
    content: {
      title: 'Save more with Suskii Prime',
      benefits: ['Member-only fares', 'Fee waivers', 'Priority support'],
      // Membership pricing is a business decision; it stays empty until the owner sets it.
      priceMonthly: null,
      priceYearly: null,
    },
  },
  {
    key: 'home.why_book',
    content: {
      items: [
        { icon: 'price', title: 'Best-price focus' },
        { icon: 'installments', title: 'Flexible payment' },
        { icon: 'support', title: '24/7 human support' },
        { icon: 'secure', title: 'Secure payments' },
      ],
    },
  },
  // Business facts: empty until the owner provides them (the web hides empty values).
  { key: 'site.contact', content: { phone: null, whatsapp: null, email: null } },
  { key: 'site.social', content: { links: [] } },
  { key: 'site.apps', content: { iosUrl: null, androidUrl: null } },
];

const FAQS: { question: string; answer: string }[] = [
  {
    question: 'How do I find my booking?',
    answer:
      'Sign in and open Trips, or use Manage booking with your booking reference, last name and a code we email you.',
  },
  {
    question: 'Can I pay in instalments?',
    answer: 'Eligible bookings show the available payment plans at checkout before you pay.',
  },
  {
    question: 'How do I contact support?',
    answer:
      'Use the contact form or WhatsApp link in the Help Center. Include your booking reference if you have one.',
  },
];

/**
 * Starter deal routes: the five origin cities of the homepage filter chips to popular
 * destinations. Configuration managed in the admin console from phase 10 (ADR-011).
 */
const DEAL_ROUTES: Record<string, string[]> = {
  LOS: ['LHR', 'DXB', 'JFK', 'ACC', 'ABV', 'JNB'],
  ABV: ['LHR', 'DXB', 'LOS', 'IST'],
  PHC: ['LOS', 'ABV', 'DXB', 'LHR'],
  ACC: ['LHR', 'LOS', 'DXB', 'JFK'],
  NBO: ['DXB', 'LHR', 'JNB', 'ZNZ'],
};

/** Top hotel destinations listed in the homepage spec, in display order. */
const HOTEL_DESTINATIONS: [city: string, countryCode: string][] = [
  ['Dubai', 'AE'],
  ['London', 'GB'],
  ['Accra', 'GH'],
  ['Nairobi', 'KE'],
  ['Cape Town', 'ZA'],
  ['Istanbul', 'TR'],
  ['Zanzibar', 'TZ'],
  ['Lagos', 'NG'],
  ['Abuja', 'NG'],
];

const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function seedContent(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  for (const signal of TRUST_SIGNALS) {
    // Create-only: re-seeding must never flip a verification decision made in the admin console.
    await prisma.trustSignal.upsert({ where: { key: signal.key }, create: signal, update: {} });
  }
  for (const block of CMS_BLOCKS) {
    await prisma.cmsBlock.upsert({
      where: { key_locale: { key: block.key, locale: 'en-NG' } },
      create: { key: block.key, locale: 'en-NG', content: block.content, publishedAt: now },
      update: {},
    });
  }
  if ((await prisma.faq.count()) === 0) {
    await prisma.faq.createMany({
      data: FAQS.map((faq, index) => ({
        ...faq,
        locale: 'en-NG',
        sortOrder: (index + 1) * 10,
        publishedAt: now,
      })),
    });
  }
}

async function seedDealsAndDestinations(prisma: PrismaClient): Promise<void> {
  const codes = [...new Set(Object.entries(DEAL_ROUTES).flat(2))];
  const airports = await prisma.airport.findMany({
    where: { iataCode: { in: codes } },
    include: { city: true },
  });
  const byCode = new Map(airports.map((airport) => [airport.iataCode, airport]));
  const cityOf = (code: string): string => {
    const airport = byCode.get(code);
    if (!airport) throw new Error(`deal route airport ${code} is missing from the reference data`);
    return airport.city?.name ?? airport.municipality ?? airport.name;
  };
  let sortOrder = 0;
  for (const [origin, destinations] of Object.entries(DEAL_ROUTES)) {
    for (const destination of destinations) {
      sortOrder += 10;
      const domestic = byCode.get(origin)?.countryCode === byCode.get(destination)?.countryCode;
      // Create-only: routes edited or deactivated in the admin console stay as they are.
      await prisma.dealRoute.upsert({
        where: {
          originCode_destinationCode_cabinClass: {
            originCode: origin,
            destinationCode: destination,
            cabinClass: 'economy',
          },
        },
        create: {
          slug: `${slugify(cityOf(origin))}-to-${slugify(cityOf(destination))}`,
          originCode: origin,
          destinationCode: destination,
          stayNights: domestic ? 3 : 7,
          sortOrder,
        },
        update: {},
      });
    }
  }

  const now = new Date();
  for (const [index, [name, countryCode]] of HOTEL_DESTINATIONS.entries()) {
    const city = await prisma.city.findUnique({
      where: { countryCode_name: { countryCode, name } },
    });
    if (!city) throw new Error(`hotel destination ${name} (${countryCode}) is missing`);
    await prisma.destinationContent.upsert({
      where: { cityId: city.id },
      create: {
        cityId: city.id,
        slug: slugify(name),
        featured: true,
        sortOrder: (index + 1) * 10,
        publishedAt: now,
      },
      update: {},
    });
  }
  process.stdout.write(
    `deals and destinations: ${sortOrder / 10} routes, ${HOTEL_DESTINATIONS.length} destinations\n`,
  );
}

async function seedLocalAdmin(prisma: PrismaClient): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SEED_ADMIN_* is for local development only; create production admins via the admin console',
    );
  }
  const normalisedEmail = emailSchema.parse(email);
  passwordSchema.parse(password);
  const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  await prisma.user.upsert({
    where: { email: normalisedEmail },
    create: {
      email: normalisedEmail,
      emailVerifiedAt: new Date(),
      passwordHash,
      displayName: 'Local admin',
      roles: { create: [{ roleKey: 'customer' }, { roleKey: 'super_admin' }] },
    },
    update: {},
  });
  process.stdout.write(
    'local super admin ensured (enrol MFA via /v1/me/mfa/totp before using admin routes)\n',
  );
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await seedReferenceData(prisma);
    await syncRbacCatalog(prisma);
    await seedContent(prisma);
    await seedDealsAndDestinations(prisma);
    await seedLocalAdmin(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`seed failed: ${(error as Error).message}\n`);
  process.exit(1);
});
