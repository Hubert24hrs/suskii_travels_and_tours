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
 * - Draft CMS blocks and FAQs (unpublished) for the homepage build in phase 4.
 * - Optional local super admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (never in production).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { parse } from 'csv-parse/sync';

import { emailSchema, passwordSchema } from '@suskii/shared';

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
    const key = `${airport.country_code}|${airport.municipality}`;
    const current = cityByKey.get(key);
    if (!current || rank[airport.type] < rank[current.type]) cityByKey.set(key, airport);
  }
  await prisma.city.createMany({
    data: [...cityByKey.values()].map((airport) => ({
      name: airport.municipality,
      countryCode: airport.country_code,
      latitude: Number(airport.latitude),
      longitude: Number(airport.longitude),
      timezone: airport.timezone,
    })),
    skipDuplicates: true,
  });
  const cities = await prisma.city.findMany({
    select: { id: true, name: true, countryCode: true },
  });
  const cityId = new Map(cities.map((city) => [`${city.countryCode}|${city.name}`, city.id]));

  for (const batch of chunks(airports, BATCH)) {
    await prisma.$transaction(
      batch.map((airport) => {
        const data = {
          icaoCode: airport.icao_code || null,
          name: airport.name,
          type: airport.type,
          municipality: airport.municipality || null,
          cityId: cityId.get(`${airport.country_code}|${airport.municipality}`) ?? null,
          countryCode: airport.country_code,
          latitude: Number(airport.latitude),
          longitude: Number(airport.longitude),
          timezone: airport.timezone,
          scheduledService: true,
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

/** Draft copy taken from the homepage spec; prices and business facts are left for the owner. */
const CMS_BLOCKS: { key: string; content: Prisma.InputJsonObject }[] = [
  {
    key: 'home.hero',
    content: {
      headline: 'Your one-stop travel shop',
      subheadline: 'Flights, hotels, packages, tours, visa help and travel add-ons in one place.',
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

async function seedContent(prisma: PrismaClient): Promise<void> {
  for (const signal of TRUST_SIGNALS) {
    // Create-only: re-seeding must never flip a verification decision made in the admin console.
    await prisma.trustSignal.upsert({ where: { key: signal.key }, create: signal, update: {} });
  }
  for (const block of CMS_BLOCKS) {
    await prisma.cmsBlock.upsert({
      where: { key_locale: { key: block.key, locale: 'en-NG' } },
      create: { key: block.key, locale: 'en-NG', content: block.content },
      update: {},
    });
  }
  if ((await prisma.faq.count()) === 0) {
    await prisma.faq.createMany({
      data: FAQS.map((faq, index) => ({ ...faq, locale: 'en-NG', sortOrder: (index + 1) * 10 })),
    });
  }
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
    await seedLocalAdmin(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`seed failed: ${(error as Error).message}\n`);
  process.exit(1);
});
