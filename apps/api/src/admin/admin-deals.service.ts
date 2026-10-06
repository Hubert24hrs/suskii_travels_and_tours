import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { AuditService } from '../audit/audit.service';
import { ProblemDetailsException } from '../common/problem-details';
import {
  Prisma,
  type City,
  type DealRoute,
  type DestinationContent,
} from '../generated/prisma/client';
import { cityUnknown } from '../inhouse/catalog-admin.service';
import { PrismaService } from '../infra/prisma.service';

import { checkMerged, conflict, fieldChanges, hasChanges, type StaffActor } from './admin-helpers';
import {
  dealRouteCheck,
  type adminDealRouteSchema,
  type adminDestinationSchema,
  type DealRouteFields,
  type DestinationFields,
} from './admin-deals.schemas';

type AdminDealRoute = z.infer<typeof adminDealRouteSchema>;
type AdminDestination = z.infer<typeof adminDestinationSchema>;
type RouteRow = DealRoute & { snapshots: { fetchedAt: Date }[] };
type DestinationRow = DestinationContent & { city: City };

const latestSnapshot = {
  snapshots: { select: { fetchedAt: true }, orderBy: { fetchedAt: 'desc' }, take: 1 },
} as const;

function routeFields(row: DealRoute): DealRouteFields {
  return {
    slug: row.slug,
    originCode: row.originCode,
    destinationCode: row.destinationCode,
    cabinClass: row.cabinClass,
    stayNights: row.stayNights,
    active: row.active,
    sortOrder: row.sortOrder,
  };
}

const presentRoute = (row: RouteRow): AdminDealRoute => ({
  ...routeFields(row),
  id: row.id,
  lastRefreshedAt: row.snapshots[0]?.fetchedAt.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

function destinationFields(row: DestinationContent): DestinationFields {
  return {
    cityId: row.cityId,
    slug: row.slug,
    featured: row.featured,
    sortOrder: row.sortOrder,
    imageUrl: row.imageUrl,
    published: row.publishedAt !== null,
  };
}

const presentDestination = (row: DestinationRow): AdminDestination => ({
  ...destinationFields(row),
  id: row.id,
  cityName: row.city.name,
  countryCode: row.city.countryCode,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const airportUnknown = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'airport-unknown',
    'Unknown airport',
    'Choose airports from the reference data.',
  );

/**
 * Deal routes and hotel destinations for staff (ADR-011, ADR-035). Routes are deactivated and
 * destinations unpublished rather than deleted, so their snapshots and SEO pages stay coherent.
 * The deals worker picks route changes up on its next refresh.
 */
@Injectable()
export class AdminDealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listRoutes(): Promise<{ routes: AdminDealRoute[] }> {
    const rows = await this.prisma.dealRoute.findMany({
      include: latestSnapshot,
      orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { slug: 'asc' }],
    });
    return { routes: rows.map(presentRoute) };
  }

  async createRoute(input: DealRouteFields, staff: StaffActor): Promise<AdminDealRoute> {
    await this.assertAirports(input);
    return this.uniqueRoute(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.dealRoute.create({ data: input, include: latestSnapshot });
        await this.audit.record(
          {
            action: 'deals.route_created',
            actorUserId: staff.userId,
            targetType: 'deal_route',
            targetId: created.id,
            context: staff.context,
            metadata: { changes: fieldChanges({}, input) },
          },
          tx,
        );
        return presentRoute(created);
      }),
    );
  }

  async updateRoute(
    id: string,
    patch: Partial<DealRouteFields>,
    staff: StaffActor,
  ): Promise<AdminDealRoute> {
    return this.uniqueRoute(() =>
      this.prisma.$transaction(async (tx) => {
        const existing = await tx.dealRoute.findUnique({ where: { id }, include: latestSnapshot });
        if (!existing) throw new NotFoundException();
        const before = routeFields(existing);
        const after = checkMerged(dealRouteCheck, { ...before, ...patch });
        const changes = fieldChanges(before, after);
        if (!hasChanges(changes)) return presentRoute(existing);
        await this.assertAirports(after, tx);
        const updated = await tx.dealRoute.update({
          where: { id },
          data: after,
          include: latestSnapshot,
        });
        await this.audit.record(
          {
            action: 'deals.route_updated',
            actorUserId: staff.userId,
            targetType: 'deal_route',
            targetId: id,
            context: staff.context,
            metadata: { changes },
          },
          tx,
        );
        return presentRoute(updated);
      }),
    );
  }

  async listDestinations(): Promise<{ destinations: AdminDestination[] }> {
    const rows = await this.prisma.destinationContent.findMany({
      include: { city: true },
      orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { slug: 'asc' }],
    });
    return { destinations: rows.map(presentDestination) };
  }

  async createDestination(input: DestinationFields, staff: StaffActor): Promise<AdminDestination> {
    const city = await this.prisma.city.findUnique({ where: { id: input.cityId } });
    if (!city) throw cityUnknown();
    return this.uniqueDestination(() =>
      this.prisma.$transaction(async (tx) => {
        const { published, ...fields } = input;
        const created = await tx.destinationContent.create({
          data: { ...fields, publishedAt: published ? new Date() : null },
          include: { city: true },
        });
        await this.audit.record(
          {
            action: 'destination.created',
            actorUserId: staff.userId,
            targetType: 'destination',
            targetId: created.id,
            context: staff.context,
            metadata: { changes: fieldChanges({}, input) },
          },
          tx,
        );
        return presentDestination(created);
      }),
    );
  }

  async updateDestination(
    id: string,
    patch: Partial<Omit<DestinationFields, 'cityId'>>,
    staff: StaffActor,
  ): Promise<AdminDestination> {
    return this.uniqueDestination(() =>
      this.prisma.$transaction(async (tx) => {
        const existing = await tx.destinationContent.findUnique({
          where: { id },
          include: { city: true },
        });
        if (!existing) throw new NotFoundException();
        const before = destinationFields(existing);
        const after = { ...before, ...patch };
        const changes = fieldChanges(before, after);
        if (!hasChanges(changes)) return presentDestination(existing);
        const { published, cityId: _cityId, ...fields } = after;
        const updated = await tx.destinationContent.update({
          where: { id },
          data: {
            ...fields,
            // Publishing keeps the first publication time; unpublishing clears it.
            publishedAt: published ? (existing.publishedAt ?? new Date()) : null,
          },
          include: { city: true },
        });
        await this.audit.record(
          {
            action: 'destination.updated',
            actorUserId: staff.userId,
            targetType: 'destination',
            targetId: id,
            context: staff.context,
            metadata: { changes },
          },
          tx,
        );
        return presentDestination(updated);
      }),
    );
  }

  private async assertAirports(
    route: Pick<DealRouteFields, 'originCode' | 'destinationCode'>,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const found = await tx.airport.count({
      where: { iataCode: { in: [route.originCode, route.destinationCode] } },
    });
    if (found !== 2) throw airportUnknown();
  }

  private async uniqueRoute<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('deal-route-exists', 'A route with this slug or these airports exists');
      }
      throw error;
    }
  }

  private async uniqueDestination<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('destination-exists', 'A destination with this slug or city exists');
      }
      throw error;
    }
  }
}
