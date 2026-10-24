/**
 * Sample Cars inventory (ADR-049) for local development and the e2e suites, run by
 * `db:seed:demo`: three bus operators, twelve terminals in Lagos, Ogun, Oyo, Abuja and Rivers,
 * routes with two weeks of departures and seat maps, Lagos ride places and fares, twenty demo
 * drivers with vehicles, and eight rental cars.
 *
 * Every operator, driver and vehicle is marked `sample` and none of it is a real company, person,
 * fare or car. Idempotent: rows are upserted by natural keys and departures are only added for
 * dates and times that have none.
 */
import { addDays, localToUtc } from '@suskii/shared';

import { parseEnv } from '../src/config/env.schema';
import {
  driverLicenceContext,
  driverNinContext,
  driverPayoutContext,
} from '../src/crypto/encryption-contexts';
import { LocalKeyFieldEncryption } from '../src/crypto/field-encryption';
import { HmacService } from '../src/crypto/hmac.service';
import type { PrismaClient, RentalCategory, RideCategory } from '../src/generated/prisma/client';

const LAGOS_ZONE = 'Africa/Lagos';
const naira = (amount: number): bigint => BigInt(amount * 100);

const TICKET_POLICY = [
  { daysBefore: 2, refundBps: 9_000 },
  { daysBefore: 1, refundBps: 5_000 },
  { daysBefore: 0, refundBps: 0 },
];
const RENTAL_POLICY = [
  { daysBefore: 3, refundBps: 10_000 },
  { daysBefore: 1, refundBps: 5_000 },
  { daysBefore: 0, refundBps: 0 },
];

const OPERATORS = [
  { slug: 'sample-lagoon-express', name: 'Lagoon Express (sample)' },
  { slug: 'sample-savannah-coaches', name: 'Savannah Coaches (sample)' },
  { slug: 'sample-delta-star', name: 'Delta Star Motors (sample)' },
] as const;

interface TerminalSeed {
  slug: string;
  name: string;
  city: string;
  state: string;
  address: string;
  lat: number;
  lng: number;
}

/** Area-level positions for sample terminals; not the addresses of real companies' parks. */
const TERMINALS: TerminalSeed[] = [
  {
    slug: 'sample-lagos-jibowu',
    name: 'Jibowu terminal',
    city: 'Lagos',
    state: 'Lagos',
    address: 'Ikorodu Road, Jibowu, Lagos',
    lat: 6.5165,
    lng: 3.3716,
  },
  {
    slug: 'sample-lagos-ojota',
    name: 'Ojota terminal',
    city: 'Lagos',
    state: 'Lagos',
    address: 'Ikorodu Road, Ojota, Lagos',
    lat: 6.5869,
    lng: 3.3817,
  },
  {
    slug: 'sample-lagos-ajah',
    name: 'Ajah terminal',
    city: 'Lagos',
    state: 'Lagos',
    address: 'Lekki-Epe Expressway, Ajah, Lagos',
    lat: 6.4683,
    lng: 3.5852,
  },
  {
    slug: 'sample-lagos-iyana-ipaja',
    name: 'Iyana Ipaja terminal',
    city: 'Lagos',
    state: 'Lagos',
    address: 'Lagos-Abeokuta Expressway, Iyana Ipaja, Lagos',
    lat: 6.6132,
    lng: 3.2836,
  },
  {
    slug: 'sample-abeokuta-kuto',
    name: 'Kuto terminal',
    city: 'Abeokuta',
    state: 'Ogun',
    address: 'Kuto, Abeokuta',
    lat: 7.1475,
    lng: 3.3619,
  },
  {
    slug: 'sample-sagamu-interchange',
    name: 'Sagamu interchange terminal',
    city: 'Sagamu',
    state: 'Ogun',
    address: 'Sagamu Interchange, Sagamu',
    lat: 6.8396,
    lng: 3.646,
  },
  {
    slug: 'sample-ibadan-challenge',
    name: 'Challenge terminal',
    city: 'Ibadan',
    state: 'Oyo',
    address: 'Challenge, Ibadan',
    lat: 7.3537,
    lng: 3.8714,
  },
  {
    slug: 'sample-ibadan-iwo-road',
    name: 'Iwo Road terminal',
    city: 'Ibadan',
    state: 'Oyo',
    address: 'Iwo Road, Ibadan',
    lat: 7.4083,
    lng: 3.9327,
  },
  {
    slug: 'sample-abuja-utako',
    name: 'Utako terminal',
    city: 'Abuja',
    state: 'FCT',
    address: 'Utako District, Abuja',
    lat: 9.07,
    lng: 7.438,
  },
  {
    slug: 'sample-abuja-jabi',
    name: 'Jabi terminal',
    city: 'Abuja',
    state: 'FCT',
    address: 'Jabi District, Abuja',
    lat: 9.065,
    lng: 7.425,
  },
  {
    slug: 'sample-port-harcourt-waterlines',
    name: 'Waterlines terminal',
    city: 'Port Harcourt',
    state: 'Rivers',
    address: 'Aba Road, Waterlines, Port Harcourt',
    lat: 4.8156,
    lng: 7.0498,
  },
  {
    slug: 'sample-port-harcourt-mile-one',
    name: 'Mile 1 terminal',
    city: 'Port Harcourt',
    state: 'Rivers',
    address: 'Mile 1, Diobu, Port Harcourt',
    lat: 4.802,
    lng: 7.005,
  },
];

interface RouteSeed {
  operator: (typeof OPERATORS)[number]['slug'];
  from: string;
  to: string;
  km: number;
  minutes: number;
  fare: number;
  layout: 'coach' | 'executive' | 'minibus';
  /** Local departure times. */
  times: string[];
}

const ROUTES: RouteSeed[] = [
  {
    operator: 'sample-lagoon-express',
    from: 'sample-lagos-jibowu',
    to: 'sample-ibadan-challenge',
    km: 128,
    minutes: 150,
    fare: 8_500,
    layout: 'minibus',
    times: ['06:30', '14:00'],
  },
  {
    operator: 'sample-lagoon-express',
    from: 'sample-lagos-iyana-ipaja',
    to: 'sample-abeokuta-kuto',
    km: 80,
    minutes: 120,
    fare: 6_000,
    layout: 'minibus',
    times: ['07:00', '15:30'],
  },
  {
    operator: 'sample-lagoon-express',
    from: 'sample-lagos-ojota',
    to: 'sample-sagamu-interchange',
    km: 50,
    minutes: 75,
    fare: 4_000,
    layout: 'minibus',
    times: ['08:00'],
  },
  {
    operator: 'sample-savannah-coaches',
    from: 'sample-lagos-jibowu',
    to: 'sample-abuja-utako',
    km: 760,
    minutes: 660,
    fare: 32_000,
    layout: 'coach',
    times: ['06:00'],
  },
  {
    operator: 'sample-savannah-coaches',
    from: 'sample-ibadan-iwo-road',
    to: 'sample-abuja-jabi',
    km: 650,
    minutes: 600,
    fare: 30_000,
    layout: 'executive',
    times: ['07:00'],
  },
  {
    operator: 'sample-savannah-coaches',
    from: 'sample-lagos-ojota',
    to: 'sample-ibadan-iwo-road',
    km: 130,
    minutes: 150,
    fare: 9_000,
    layout: 'executive',
    times: ['09:00', '16:00'],
  },
  {
    operator: 'sample-delta-star',
    from: 'sample-lagos-ajah',
    to: 'sample-port-harcourt-waterlines',
    km: 620,
    minutes: 600,
    fare: 28_000,
    layout: 'coach',
    times: ['06:00'],
  },
  {
    operator: 'sample-delta-star',
    from: 'sample-abuja-utako',
    to: 'sample-port-harcourt-mile-one',
    km: 600,
    minutes: 600,
    fare: 27_000,
    layout: 'executive',
    times: ['06:30'],
  },
];

const seatRow = (row: number, cells: (string | null)[]): (string | null)[] =>
  cells.map((cell) => (cell === null ? null : `${row}${cell}`));

const LAYOUTS: Record<
  RouteSeed['layout'],
  { name: string; layout: { rows: (string | null)[][] }; amenities: string[] }
> = {
  // 2 + 2 with an aisle, 12 rows: 48 seats.
  coach: {
    name: 'Coach 2+2 (sample)',
    layout: {
      rows: Array.from({ length: 12 }, (_, index) =>
        seatRow(index + 1, ['A', 'B', null, 'C', 'D']),
      ),
    },
    amenities: ['air_conditioning', 'usb_charging', 'toilet'],
  },
  // 2 + 1 recliners, 10 rows: 30 seats.
  executive: {
    name: 'Executive 2+1 (sample)',
    layout: {
      rows: Array.from({ length: 10 }, (_, index) => seatRow(index + 1, ['A', 'B', null, 'C'])),
    },
    amenities: ['air_conditioning', 'usb_charging', 'reclining_seats', 'wifi'],
  },
  // 14-seat minibus: two beside the driver, then four rows of three.
  minibus: {
    name: 'Minibus 14 (sample)',
    layout: {
      rows: [
        seatRow(1, [null, 'A', 'B']),
        ...Array.from({ length: 4 }, (_, index) => seatRow(index + 2, ['A', 'B', 'C'])),
      ],
    },
    amenities: ['air_conditioning'],
  },
};

/** Lagos pickup places riders choose from (ADR-053); area names, not businesses. */
const PLACES = [
  { name: 'Murtala Muhammed International Airport', kind: 'airport', lat: 6.5774, lng: 3.3212 },
  { name: 'Ikeja (Allen Avenue)', kind: 'landmark', lat: 6.6018, lng: 3.3515 },
  { name: 'Lekki Phase 1', kind: 'landmark', lat: 6.4474, lng: 3.4723 },
  { name: 'Victoria Island', kind: 'landmark', lat: 6.4281, lng: 3.4219 },
  { name: 'Ikoyi', kind: 'landmark', lat: 6.4549, lng: 3.4346 },
  { name: 'Yaba', kind: 'landmark', lat: 6.5095, lng: 3.3711 },
  { name: 'Surulere (National Stadium)', kind: 'landmark', lat: 6.4985, lng: 3.3653 },
  { name: 'Lagos Island (Marina)', kind: 'landmark', lat: 6.4511, lng: 3.3891 },
  { name: 'Festac Town', kind: 'landmark', lat: 6.4664, lng: 3.2836 },
  { name: 'Ajah', kind: 'landmark', lat: 6.4683, lng: 3.5852 },
  { name: 'Jibowu terminal', kind: 'terminal', lat: 6.5165, lng: 3.3716 },
  { name: 'Ojota terminal', kind: 'terminal', lat: 6.5869, lng: 3.3817 },
] as const;

const FARES: Record<
  RideCategory,
  { base: number; perKm: number; perMinute: number; minimum: number }
> = {
  standard: { base: 500, perKm: 150, perMinute: 20, minimum: 1_500 },
  comfort: { base: 700, perKm: 210, perMinute: 28, minimum: 2_100 },
  xl: { base: 800, perKm: 240, perMinute: 32, minimum: 2_400 },
};

const GIVEN_NAMES = [
  'Tunde',
  'Ngozi',
  'Emeka',
  'Aisha',
  'Bayo',
  'Chioma',
  'Ibrahim',
  'Funmi',
  'Kelechi',
  'Zainab',
];
const SURNAMES = [
  'Adeyemi',
  'Okafor',
  'Bello',
  'Eze',
  'Ogunleye',
  'Nwosu',
  'Abubakar',
  'Oladipo',
  'Okonkwo',
  'Musa',
];
const CARS: {
  make: string;
  model: string;
  colour: string;
  category: RideCategory;
  seats: number;
}[] = [
  { make: 'Toyota', model: 'Corolla', colour: 'Silver', category: 'standard', seats: 4 },
  { make: 'Honda', model: 'Accord', colour: 'Black', category: 'comfort', seats: 4 },
  { make: 'Toyota', model: 'Sienna', colour: 'Grey', category: 'xl', seats: 6 },
  { make: 'Hyundai', model: 'Elantra', colour: 'White', category: 'standard', seats: 4 },
];

interface RentalSeed {
  slug: string;
  make: string;
  model: string;
  year: number;
  category: RentalCategory;
  transmission: 'automatic' | 'manual';
  seats: number;
  daily: number;
  chauffeur: number | null;
  deposit: number;
  branch: 'ikeja' | 'lekki';
  features: string[];
}

const RENTALS: RentalSeed[] = [
  {
    slug: 'sample-toyota-corolla',
    make: 'Toyota',
    model: 'Corolla',
    year: 2020,
    category: 'economy',
    transmission: 'automatic',
    seats: 5,
    daily: 45_000,
    chauffeur: 15_000,
    deposit: 100_000,
    branch: 'ikeja',
    features: ['air_conditioning', 'bluetooth'],
  },
  {
    slug: 'sample-hyundai-elantra',
    make: 'Hyundai',
    model: 'Elantra',
    year: 2019,
    category: 'economy',
    transmission: 'manual',
    seats: 5,
    daily: 38_000,
    chauffeur: null,
    deposit: 80_000,
    branch: 'ikeja',
    features: ['air_conditioning'],
  },
  {
    slug: 'sample-honda-civic',
    make: 'Honda',
    model: 'Civic',
    year: 2021,
    category: 'compact',
    transmission: 'automatic',
    seats: 5,
    daily: 50_000,
    chauffeur: 15_000,
    deposit: 100_000,
    branch: 'lekki',
    features: ['air_conditioning', 'bluetooth', 'reverse_camera'],
  },
  {
    slug: 'sample-toyota-rav4',
    make: 'Toyota',
    model: 'RAV4',
    year: 2021,
    category: 'suv',
    transmission: 'automatic',
    seats: 5,
    daily: 75_000,
    chauffeur: 20_000,
    deposit: 150_000,
    branch: 'ikeja',
    features: ['air_conditioning', 'bluetooth', 'reverse_camera'],
  },
  {
    slug: 'sample-kia-sportage',
    make: 'Kia',
    model: 'Sportage',
    year: 2020,
    category: 'suv',
    transmission: 'automatic',
    seats: 5,
    daily: 70_000,
    chauffeur: 20_000,
    deposit: 150_000,
    branch: 'lekki',
    features: ['air_conditioning', 'bluetooth'],
  },
  {
    slug: 'sample-toyota-land-cruiser-prado',
    make: 'Toyota',
    model: 'Land Cruiser Prado',
    year: 2022,
    category: 'luxury',
    transmission: 'automatic',
    seats: 7,
    daily: 150_000,
    chauffeur: 25_000,
    deposit: 300_000,
    branch: 'lekki',
    features: ['air_conditioning', 'leather_seats', 'four_wheel_drive'],
  },
  {
    slug: 'sample-lexus-es',
    make: 'Lexus',
    model: 'ES 350',
    year: 2021,
    category: 'luxury',
    transmission: 'automatic',
    seats: 5,
    daily: 130_000,
    chauffeur: 25_000,
    deposit: 300_000,
    branch: 'ikeja',
    features: ['air_conditioning', 'leather_seats', 'bluetooth'],
  },
  {
    slug: 'sample-toyota-hiace',
    make: 'Toyota',
    model: 'Hiace',
    year: 2019,
    category: 'van',
    transmission: 'manual',
    seats: 14,
    daily: 90_000,
    chauffeur: 20_000,
    deposit: 200_000,
    branch: 'ikeja',
    features: ['air_conditioning'],
  },
];

const BRANCHES = {
  ikeja: {
    name: 'Ikeja branch (sample)',
    address: 'Allen Avenue, Ikeja, Lagos',
    lat: 6.6018,
    lng: 3.3515,
  },
  lekki: {
    name: 'Lekki branch (sample)',
    address: 'Admiralty Way, Lekki Phase 1, Lagos',
    lat: 6.4474,
    lng: 3.4723,
  },
} as const;

async function seedBuses(prisma: PrismaClient): Promise<void> {
  const operators = new Map<string, string>();
  for (const seed of OPERATORS) {
    const data = {
      name: seed.name,
      status: 'published' as const,
      sample: true,
      cancellationPolicy: TICKET_POLICY,
    };
    const row = await prisma.busOperator.upsert({
      where: { slug: seed.slug },
      create: { slug: seed.slug, ...data },
      update: data,
    });
    operators.set(seed.slug, row.id);
  }
  const terminals = new Map<string, string>();
  for (const seed of TERMINALS) {
    const data = {
      name: seed.name,
      cityName: seed.city,
      stateName: seed.state,
      countryCode: 'NG',
      address: seed.address,
      lat: seed.lat,
      lng: seed.lng,
      timeZone: LAGOS_ZONE,
      active: true,
      sample: true,
    };
    const row = await prisma.busTerminal.upsert({
      where: { slug: seed.slug },
      create: { slug: seed.slug, ...data },
      update: data,
    });
    terminals.set(seed.slug, row.id);
  }

  const layouts = new Map<string, string>();
  const layoutId = async (operatorId: string, kind: RouteSeed['layout']): Promise<string> => {
    const key = `${operatorId}:${kind}`;
    const cached = layouts.get(key);
    if (cached) return cached;
    const spec = LAYOUTS[kind];
    const seatCount = spec.layout.rows.flat().filter((cell) => cell !== null).length;
    const existing = await prisma.busLayout.findFirst({ where: { operatorId, name: spec.name } });
    const row = existing
      ? await prisma.busLayout.update({
          where: { id: existing.id },
          data: { layout: spec.layout, seatCount, amenities: spec.amenities },
        })
      : await prisma.busLayout.create({
          data: {
            operatorId,
            name: spec.name,
            layout: spec.layout,
            seatCount,
            amenities: spec.amenities,
          },
        });
    layouts.set(key, row.id);
    return row.id;
  };

  const today = new Date().toISOString().slice(0, 10);
  for (const seed of ROUTES) {
    const operatorId = operators.get(seed.operator) ?? '';
    // Both directions run the same schedule.
    for (const [from, to] of [
      [seed.from, seed.to],
      [seed.to, seed.from],
    ] as const) {
      const originId = terminals.get(from) ?? '';
      const destinationId = terminals.get(to) ?? '';
      const route = await prisma.busRoute.upsert({
        where: { operatorId_originId_destinationId: { operatorId, originId, destinationId } },
        create: {
          operatorId,
          originId,
          destinationId,
          distanceKm: seed.km,
          durationMinutes: seed.minutes,
        },
        update: { distanceKm: seed.km, durationMinutes: seed.minutes, active: true },
      });
      const layout = await layoutId(operatorId, seed.layout);
      const existing = new Set(
        (
          await prisma.busTrip.findMany({
            where: { routeId: route.id, departsAt: { gte: new Date() } },
            select: { departsAtLocal: true },
          })
        ).map((trip) => trip.departsAtLocal),
      );
      const trips = [];
      for (let day = 1; day <= 14; day += 1) {
        const date = addDays(today, day);
        for (const time of seed.times) {
          const local = `${date}T${time}`;
          if (existing.has(local)) continue;
          const departsAt = localToUtc(local, LAGOS_ZONE);
          trips.push({
            routeId: route.id,
            layoutId: layout,
            departsAt,
            departsAtLocal: local,
            arrivesAt: new Date(departsAt.getTime() + seed.minutes * 60_000),
            fareMinor: naira(seed.fare),
            currency: 'NGN',
            sample: true,
          });
        }
      }
      if (trips.length > 0) await prisma.busTrip.createMany({ data: trips });
    }
  }
}

async function seedRides(prisma: PrismaClient): Promise<void> {
  for (const place of PLACES) {
    const existing = await prisma.ridePlace.findFirst({
      where: { name: place.name, cityName: 'Lagos' },
    });
    const data = { ...place, cityName: 'Lagos', active: true, sample: true };
    if (existing) await prisma.ridePlace.update({ where: { id: existing.id }, data });
    else await prisma.ridePlace.create({ data });
  }
  for (const [category, fare] of Object.entries(FARES) as [
    RideCategory,
    (typeof FARES)[RideCategory],
  ][]) {
    const data = {
      currency: 'NGN',
      baseMinor: naira(fare.base),
      perKmMinor: naira(fare.perKm),
      perMinuteMinor: naira(fare.perMinute),
      bookingFeeMinor: naira(200),
      minimumMinor: naira(fare.minimum),
      cancellationFeeMinor: naira(500),
      freeCancelSeconds: 120,
      waitGraceSeconds: 300,
      driverShareBps: 8_000,
      active: true,
    };
    await prisma.rideFareRule.upsert({
      where: { cityName_category: { cityName: 'Lagos', category } },
      create: { cityName: 'Lagos', category, ...data },
      update: data,
    });
  }
}

/**
 * Twenty approved demo drivers spread around Lagos, offline until something drives them (the
 * e2e suites sign in their own drivers). Identity numbers are fake, encrypted and HMAC-indexed
 * exactly like real ones, with the keys the API is configured with.
 */
async function seedDrivers(prisma: PrismaClient): Promise<void> {
  // Only the encryption and HMAC keys matter here; the seed never talks to Redis.
  const config = parseEnv({ REDIS_URL: 'redis://127.0.0.1:6379', ...process.env });
  const encryption = new LocalKeyFieldEncryption(config);
  const hmac = new HmacService(config);
  for (let index = 0; index < 20; index += 1) {
    const number = String(index + 1).padStart(2, '0');
    const email = `sample.driver${number}@drivers.example.invalid`;
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, displayName: `Sample driver ${number}` },
      update: {},
    });
    for (const roleKey of ['customer', 'driver'] as const) {
      await prisma.userRole.upsert({
        where: { userId_roleKey: { userId: user.id, roleKey } },
        create: { userId: user.id, roleKey },
        update: {},
      });
    }
    const nin = `100000000${number}`;
    const licence = `SMP${number}DRV`;
    const existing = await prisma.driver.findUnique({ where: { userId: user.id } });
    const id = existing?.id ?? crypto.randomUUID();
    const data = {
      status: 'approved' as const,
      sample: true,
      givenNames: GIVEN_NAMES[index % GIVEN_NAMES.length] ?? 'Sample',
      surname: SURNAMES[Math.floor(index / 2) % SURNAMES.length] ?? 'Driver',
      dateOfBirth: new Date(`19${80 + (index % 15)}-0${(index % 9) + 1}-15T00:00:00Z`),
      cityName: 'Lagos',
      ninEncrypted: encryption.encrypt(nin, driverNinContext(id)),
      ninHash: hmac.digest('driver-nin', nin),
      identityCheck: 'verified',
      identityReference: `mock-sample-${number}`,
      licenceEncrypted: encryption.encrypt(licence, driverLicenceContext(id)),
      licenceHash: hmac.digest('driver-licence', licence),
      licenceExpiresOn: new Date('2030-12-31T00:00:00Z'),
      licenceCheck: 'verified',
      licenceReference: `mock-sample-lic-${number}`,
      payoutAccountEncrypted: encryption.encrypt(
        JSON.stringify({
          bankCode: '000',
          accountNumber: `01234567${number}`,
          accountName: `Sample driver ${number}`,
        }),
        driverPayoutContext(id),
      ),
      reviewedAt: new Date(),
      statusReason: null,
    };
    await prisma.driver.upsert({
      where: { userId: user.id },
      create: { id, userId: user.id, ...data },
      update: data,
    });
    const car = CARS[index % CARS.length] ?? CARS[0];
    if (!car) continue;
    const plate = `SMP-${String(index + 101)}-LA`;
    const vehicle = {
      driverId: id,
      make: car.make,
      model: car.model,
      year: 2016 + (index % 7),
      colour: car.colour,
      category: car.category,
      seats: car.seats,
      insuranceExpiresOn: new Date('2030-12-31T00:00:00Z'),
      status: 'approved' as const,
      active: true,
    };
    await prisma.driverVehicle.upsert({
      where: { plate },
      create: { plate, ...vehicle },
      update: vehicle,
    });
  }
}

async function seedRentals(prisma: PrismaClient): Promise<void> {
  for (const [index, seed] of RENTALS.entries()) {
    const branch = BRANCHES[seed.branch];
    const data = {
      status: 'published' as const,
      sample: true,
      make: seed.make,
      model: seed.model,
      year: seed.year,
      category: seed.category,
      transmission: seed.transmission,
      seats: seed.seats,
      plate: `SMP-R${String(index + 1).padStart(2, '0')}-LA`,
      features: seed.features,
      artKey: null,
      cityName: 'Lagos',
      branchName: branch.name,
      branchAddress: branch.address,
      lat: branch.lat,
      lng: branch.lng,
      timeZone: LAGOS_ZONE,
      currency: 'NGN',
      dailyMinor: naira(seed.daily),
      chauffeurDailyMinor: seed.chauffeur === null ? null : naira(seed.chauffeur),
      depositMinor: naira(seed.deposit),
      // Delivery within 25 km at NGN 500 a kilometre; 200 km a day included, NGN 150 per extra km.
      deliveryPerKmMinor: naira(500),
      deliveryMaxKm: 25,
      mileageKmPerDay: seed.category === 'luxury' ? 150 : 200,
      excessKmMinor: naira(150),
      fuelPolicy: 'full_to_full',
      insuranceSummary:
        'Sample cover: third party and theft; damage beyond the deposit is charged at cost.',
      cancellationPolicy: RENTAL_POLICY,
    };
    await prisma.rentalVehicle.upsert({
      where: { slug: seed.slug },
      create: { slug: seed.slug, ...data },
      update: data,
    });
  }
}

export async function seedCars(prisma: PrismaClient): Promise<void> {
  await seedBuses(prisma);
  await seedRides(prisma);
  await seedDrivers(prisma);
  await seedRentals(prisma);
}
