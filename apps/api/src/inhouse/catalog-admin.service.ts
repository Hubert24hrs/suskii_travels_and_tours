import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { localToUtc } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { storedPrices } from '../bookings/inhouse-catalog';
import { toJsonValue } from '../common/json';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import type {
  adminDepartureSchema,
  adminProductSchema,
  createAddonSchema,
  createPackageDepartureSchema,
  createPackageSchema,
  createTourDepartureSchema,
  createTourSchema,
  createVisaProductSchema,
  updateAddonSchema,
  updateDepartureSchema,
  updatePackageSchema,
  updateTourSchema,
  updateVisaProductSchema,
} from './inhouse.schemas';

type AdminProduct = z.infer<typeof adminProductSchema>;
type AdminDeparture = z.infer<typeof adminDepartureSchema>;
type ProductKind = AdminProduct['kind'];
type Json = Prisma.InputJsonValue;

export interface StaffActor {
  userId: string;
  context: RequestContext;
}

export const slugTaken = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'slug-taken',
    'This slug is already used',
    'Choose another slug.',
  );

export const capacityBelowBooked = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'capacity-below-booked',
    'Capacity is below the places already taken',
    'Reserved and sold places cannot be removed; cancel those bookings first.',
  );

export const cityUnknown = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'city-unknown',
    'Unknown city',
    'Choose a city from the reference data.',
  );

const json = (value: unknown): Json => toJsonValue(value) as Json;
const dateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/** The named columns of a row (stored JSON columns already hold the wire shape). */
function pick<Row extends object, Key extends keyof Row>(
  row: Row,
  keys: readonly Key[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}

/** Money fields derived from a wire price for sorting and filters. */
const priceColumns = (price: { amountMinor: number; currency: string }) => ({
  price: json(price),
  currency: price.currency,
  priceMinor: BigInt(price.amountMinor),
});

/**
 * Catalog management for operations (ADR-025, `catalog:manage`): products and departures are
 * created as drafts, published and archived; every change is audited with ids only. The admin
 * console UI arrives in phase 10; until then these routes are the only way to enter inventory.
 */
@Injectable()
export class CatalogAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Listing
  // -------------------------------------------------------------------------

  async list(kind: ProductKind, status?: AdminProduct['status']): Promise<AdminProduct[]> {
    const where = status ? { status } : {};
    switch (kind) {
      case 'package': {
        const rows = await this.prisma.travelPackage.findMany({
          where,
          include: { departures: { orderBy: { startDate: 'asc' } } },
          orderBy: { updatedAt: 'desc' },
          take: 500,
        });
        return rows.map((row) => ({
          ...this.product('package', row),
          editable: pick(row, [
            'title',
            'summary',
            'nights',
            'passportRequired',
            'artKey',
            'featured',
            'highlights',
            'itinerary',
            'inclusions',
            'exclusions',
            'cancellationPolicy',
          ]),
          departures: row.departures.map((departure) =>
            this.departure(departure, isoDate(departure.startDate), isoDate(departure.endDate)),
          ),
        }));
      }
      case 'tour': {
        const rows = await this.prisma.tour.findMany({
          where,
          include: { departures: { orderBy: { startsAtUtc: 'asc' } } },
          orderBy: { updatedAt: 'desc' },
          take: 500,
        });
        return rows.map((row) => ({
          ...this.product('tour', row),
          editable: pick(row, [
            'title',
            'summary',
            'durationMinutes',
            'category',
            'artKey',
            'featured',
            'meetingPoint',
            'highlights',
            'inclusions',
            'exclusions',
            'cancellationPolicy',
          ]),
          departures: row.departures.map((departure) =>
            this.departure(departure, departure.startsAtLocal, null),
          ),
        }));
      }
      case 'addon': {
        const rows = await this.prisma.addon.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          take: 500,
        });
        return rows.map((row) => ({
          ...this.product('addon', row),
          editable: pick(row, [
            'title',
            'summary',
            'description',
            'countryCodes',
            'price',
            'maxTravellers',
            'requiredDetails',
            'cancellationPolicy',
          ]),
          departures: [],
        }));
      }
      case 'visa': {
        const rows = await this.prisma.visaProduct.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          take: 500,
        });
        return rows.map((row) => ({
          ...this.product('visa', row),
          editable: pick(row, [
            'title',
            'summary',
            'purposes',
            'processingDaysMin',
            'processingDaysMax',
            'price',
            'checklist',
            'governmentFeeNote',
          ]),
          departures: [],
        }));
      }
    }
  }

  private product(
    kind: ProductKind,
    row: {
      id: string;
      slug: string;
      title: string;
      status: AdminProduct['status'];
      sample: boolean;
      updatedAt: Date;
    },
  ): Omit<AdminProduct, 'departures' | 'editable'> {
    return {
      id: row.id,
      kind,
      slug: row.slug,
      title: row.title,
      status: row.status,
      sample: row.sample,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private departure(
    row: {
      id: string;
      capacity: number;
      seatsReserved: number;
      seatsSold: number;
      prices: unknown;
      status: AdminDeparture['status'];
    },
    startsOn: string,
    endsOn: string | null,
  ): AdminDeparture {
    const prices = storedPrices(row.prices);
    const wire = (value: { minor: bigint; currency: string } | null) =>
      value ? { amountMinor: Number(value.minor), currency: value.currency } : null;
    return {
      id: row.id,
      startsOn,
      endsOn,
      capacity: row.capacity,
      seatsReserved: row.seatsReserved,
      seatsSold: row.seatsSold,
      prices: {
        adult: { amountMinor: Number(prices.adult.minor), currency: prices.adult.currency },
        child: wire(prices.child),
        infant: wire(prices.infant),
      },
      status: row.status,
    };
  }

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------

  async createPackage(
    input: z.output<typeof createPackageSchema>,
    staff: StaffActor,
  ): Promise<{ id: string; status: 'draft' }> {
    const city = await this.city(input.cityId);
    const { cityId, highlights, itinerary, inclusions, exclusions, cancellationPolicy, ...rest } =
      input;
    return this.created('package', staff, () =>
      this.prisma.travelPackage.create({
        data: {
          ...rest,
          city: { connect: { id: cityId } },
          countryCode: city.countryCode,
          highlights: json(highlights),
          itinerary: json(itinerary),
          inclusions: json(inclusions),
          exclusions: json(exclusions),
          cancellationPolicy: json(cancellationPolicy),
        },
      }),
    );
  }

  async updatePackage(
    id: string,
    input: z.output<typeof updatePackageSchema>,
    staff: StaffActor,
  ): Promise<void> {
    const { highlights, itinerary, inclusions, exclusions, cancellationPolicy, ...rest } = input;
    await this.updated('package', id, input.status, staff, () =>
      this.prisma.travelPackage.update({
        where: { id },
        data: {
          ...rest,
          ...(highlights ? { highlights: json(highlights) } : {}),
          ...(itinerary ? { itinerary: json(itinerary) } : {}),
          ...(inclusions ? { inclusions: json(inclusions) } : {}),
          ...(exclusions ? { exclusions: json(exclusions) } : {}),
          ...(cancellationPolicy ? { cancellationPolicy: json(cancellationPolicy) } : {}),
        },
      }),
    );
  }

  async createTour(
    input: z.output<typeof createTourSchema>,
    staff: StaffActor,
  ): Promise<{ id: string; status: 'draft' }> {
    const city = await this.city(input.cityId);
    const {
      cityId,
      meetingPoint,
      highlights,
      inclusions,
      exclusions,
      cancellationPolicy,
      ...rest
    } = input;
    return this.created('tour', staff, () =>
      this.prisma.tour.create({
        data: {
          ...rest,
          city: { connect: { id: cityId } },
          countryCode: city.countryCode,
          meetingPoint: json(meetingPoint),
          highlights: json(highlights),
          inclusions: json(inclusions),
          exclusions: json(exclusions),
          cancellationPolicy: json(cancellationPolicy),
        },
      }),
    );
  }

  async updateTour(
    id: string,
    input: z.output<typeof updateTourSchema>,
    staff: StaffActor,
  ): Promise<void> {
    const { meetingPoint, highlights, inclusions, exclusions, cancellationPolicy, ...rest } = input;
    await this.updated('tour', id, input.status, staff, () =>
      this.prisma.tour.update({
        where: { id },
        data: {
          ...rest,
          ...(meetingPoint ? { meetingPoint: json(meetingPoint) } : {}),
          ...(highlights ? { highlights: json(highlights) } : {}),
          ...(inclusions ? { inclusions: json(inclusions) } : {}),
          ...(exclusions ? { exclusions: json(exclusions) } : {}),
          ...(cancellationPolicy ? { cancellationPolicy: json(cancellationPolicy) } : {}),
        },
      }),
    );
  }

  async createAddon(
    input: z.output<typeof createAddonSchema>,
    staff: StaffActor,
  ): Promise<{ id: string; status: 'draft' }> {
    const { price, requiredDetails, cancellationPolicy, ...rest } = input;
    return this.created('addon', staff, () =>
      this.prisma.addon.create({
        data: {
          ...rest,
          ...priceColumns(price),
          requiredDetails: json(requiredDetails),
          cancellationPolicy: json(cancellationPolicy),
        },
      }),
    );
  }

  async updateAddon(
    id: string,
    input: z.output<typeof updateAddonSchema>,
    staff: StaffActor,
  ): Promise<void> {
    const { price, requiredDetails, cancellationPolicy, ...rest } = input;
    await this.updated('addon', id, input.status, staff, () =>
      this.prisma.addon.update({
        where: { id },
        data: {
          ...rest,
          ...(price ? priceColumns(price) : {}),
          ...(requiredDetails ? { requiredDetails: json(requiredDetails) } : {}),
          ...(cancellationPolicy ? { cancellationPolicy: json(cancellationPolicy) } : {}),
        },
      }),
    );
  }

  async createVisaProduct(
    input: z.output<typeof createVisaProductSchema>,
    staff: StaffActor,
  ): Promise<{ id: string; status: 'draft' }> {
    const { price, checklist, ...rest } = input;
    return this.created('visa', staff, () =>
      this.prisma.visaProduct.create({
        data: { ...rest, ...priceColumns(price), checklist: json(checklist) },
      }),
    );
  }

  async updateVisaProduct(
    id: string,
    input: z.output<typeof updateVisaProductSchema>,
    staff: StaffActor,
  ): Promise<void> {
    const current = await this.prisma.visaProduct.findUnique({ where: { id } });
    if (!current) throw new NotFoundException();
    const min = input.processingDaysMin ?? current.processingDaysMin;
    const max = input.processingDaysMax ?? current.processingDaysMax;
    if (max < min) {
      throw new ProblemDetailsException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'processing-days-invalid',
        'The longest processing time is below the shortest',
        'Check the processing days.',
      );
    }
    const { price, checklist, ...rest } = input;
    await this.updated('visa', id, input.status, staff, () =>
      this.prisma.visaProduct.update({
        where: { id },
        data: {
          ...rest,
          ...(price ? priceColumns(price) : {}),
          ...(checklist ? { checklist: json(checklist) } : {}),
        },
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Departures
  // -------------------------------------------------------------------------

  async createPackageDeparture(
    packageId: string,
    input: z.output<typeof createPackageDepartureSchema>,
    staff: StaffActor,
  ): Promise<{ id: string; status: AdminDeparture['status'] }> {
    const exists = await this.prisma.travelPackage.count({ where: { id: packageId } });
    if (exists === 0) throw new NotFoundException();
    const row = await this.prisma.packageDeparture.create({
      data: {
        packageId,
        startDate: dateOnly(input.startDate),
        endDate: dateOnly(input.endDate),
        capacity: input.capacity,
        prices: json(input.prices),
        currency: input.prices.adult.currency,
        fromPriceMinor: BigInt(input.prices.adult.amountMinor),
        status: input.status,
      },
    });
    await this.record('catalog.departure_created', 'package_departure', row.id, staff, {
      packageId,
    });
    return { id: row.id, status: row.status };
  }

  async createTourDeparture(
    tourId: string,
    input: z.output<typeof createTourDepartureSchema>,
    staff: StaffActor,
  ): Promise<{ id: string; status: AdminDeparture['status'] }> {
    const tour = await this.prisma.tour.findUnique({
      where: { id: tourId },
      select: { timeZone: true },
    });
    if (!tour) throw new NotFoundException();
    const row = await this.prisma.tourDeparture.create({
      data: {
        tourId,
        startsAtLocal: input.startsAtLocal,
        startsAtUtc: localToUtc(input.startsAtLocal, tour.timeZone),
        capacity: input.capacity,
        prices: json(input.prices),
        currency: input.prices.adult.currency,
        fromPriceMinor: BigInt(input.prices.adult.amountMinor),
        status: input.status,
      },
    });
    await this.record('catalog.departure_created', 'tour_departure', row.id, staff, { tourId });
    return { id: row.id, status: row.status };
  }

  /**
   * Capacity can shrink only to what is already reserved and sold (row lock, so a booking in
   * flight cannot slip between the check and the update); prices apply to unpaid bookings at
   * their re-check before payment, through the price-change consent.
   */
  async updateDeparture(
    kind: 'package' | 'tour',
    id: string,
    input: z.output<typeof updateDepartureSchema>,
    staff: StaffActor,
  ): Promise<void> {
    const table = kind === 'package' ? Prisma.sql`package_departures` : Prisma.sql`tour_departures`;
    await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ seats: number }[]>`
        SELECT seats_reserved + seats_sold AS seats FROM ${table} WHERE id = ${id}::uuid FOR UPDATE`;
      if (!row) throw new NotFoundException();
      if (input.capacity !== undefined && input.capacity < Number(row.seats)) {
        throw capacityBelowBooked();
      }
      const data = {
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.prices
          ? {
              prices: json(input.prices),
              currency: input.prices.adult.currency,
              fromPriceMinor: BigInt(input.prices.adult.amountMinor),
            }
          : {}),
      };
      if (kind === 'package') await tx.packageDeparture.update({ where: { id }, data });
      else await tx.tourDeparture.update({ where: { id }, data });
      await this.record(
        'catalog.departure_updated',
        `${kind}_departure`,
        id,
        staff,
        { fields: Object.keys(data).join(',') },
        tx,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async city(cityId: string): Promise<{ countryCode: string }> {
    const city = await this.prisma.city.findUnique({
      where: { id: cityId },
      select: { countryCode: true },
    });
    if (!city) throw cityUnknown();
    return city;
  }

  private async created(
    kind: ProductKind,
    staff: StaffActor,
    create: () => Promise<{ id: string }>,
  ): Promise<{ id: string; status: 'draft' }> {
    let row: { id: string };
    try {
      row = await create();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw slugTaken();
      }
      throw error;
    }
    await this.record('catalog.created', kind, row.id, staff, {});
    return { id: row.id, status: 'draft' };
  }

  private async updated(
    kind: ProductKind,
    id: string,
    status: string | undefined,
    staff: StaffActor,
    update: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await update();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException();
      }
      throw error;
    }
    await this.record(
      status ? 'catalog.status_changed' : 'catalog.updated',
      kind,
      id,
      staff,
      status ? { status } : {},
    );
  }

  private async record(
    action:
      | 'catalog.created'
      | 'catalog.updated'
      | 'catalog.status_changed'
      | 'catalog.departure_created'
      | 'catalog.departure_updated',
    targetType: string,
    targetId: string,
    staff: StaffActor,
    metadata: Record<string, string>,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.audit.record(
      {
        action,
        actorUserId: staff.userId,
        targetType,
        targetId,
        context: staff.context,
        metadata,
      },
      tx,
    );
  }
}
