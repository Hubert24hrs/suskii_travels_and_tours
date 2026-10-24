import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/request-context';
import { TicketSigner } from '../ground/ticket-signer';
import { PrismaService } from '../infra/prisma.service';

import type {
  manifestSchema,
  operatorTripListSchema,
  scanResultSchema,
  ticketKeysSchema,
} from './buses.schemas';

type ScanResult = z.infer<typeof scanResultSchema>;

export interface Agent {
  userId: string;
  context: RequestContext;
}

const NOT_FOUND: ScanResult = { result: 'not_found', reason: null, ticket: null };

/**
 * Boarding (ADR-050): an operator agent scans a ticket's signed QR code. The signature and the
 * boarding window are checked first, then the agent's membership of the trip's operator (anyone
 * else gets `not_found`, like a missing ticket), and a conditional update boards each ticket once.
 * Scans made offline are uploaded later through `sync`; a second boarding is reported and audited.
 */
@Injectable()
export class BusTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: TicketSigner,
    private readonly audit: AuditService,
  ) {}

  keys(): z.infer<typeof ticketKeysSchema> {
    return { keys: this.signer.keys() };
  }

  async scan(
    qrPayload: string,
    agent: Agent,
    options: { offline: boolean; scannedAt: Date } = { offline: false, scannedAt: new Date() },
  ): Promise<ScanResult> {
    const verdict = this.signer.verify(qrPayload, options.scannedAt);
    if (!verdict.valid) return { result: 'invalid', reason: verdict.reason, ticket: null };
    const { claims } = verdict;
    const ticket = await this.prisma.busTicket.findUnique({
      where: { id: claims.tid },
      include: { trip: { include: { route: true } } },
    });
    if (ticket?.tripId !== claims.trp || ticket.seatNumber !== claims.st) return NOT_FOUND;
    if (!(await this.isAgentOf(agent.userId, ticket.trip.route.operatorId))) return NOT_FOUND;

    const passenger = await this.prisma.bookingPassenger.findUnique({
      where: { id: ticket.passengerId },
      select: { givenNames: true, surname: true },
    });
    const view = (boardedAt: Date | null) => ({
      id: ticket.id,
      tripId: ticket.tripId,
      seatNumber: ticket.seatNumber,
      passengerName: passenger ? `${passenger.givenNames} ${passenger.surname}` : '',
      boardedAt: boardedAt?.toISOString() ?? null,
    });

    let result: ScanResult['result'];
    let boardedAt: Date | null = ticket.boardedAt;
    if (ticket.status === 'void') {
      result = 'void';
    } else {
      const { count } = await this.prisma.busTicket.updateMany({
        where: { id: ticket.id, status: 'valid' },
        data: { status: 'boarded', boardedAt: options.scannedAt, boardedById: agent.userId },
      });
      if (count === 1) {
        result = 'boarded';
        boardedAt = options.scannedAt;
      } else {
        result = 'already_boarded';
        boardedAt =
          (await this.prisma.busTicket.findUnique({ where: { id: ticket.id } }))?.boardedAt ?? null;
      }
    }
    await this.prisma.busTicketScan.create({
      data: {
        ticketId: ticket.id,
        agentUserId: agent.userId,
        scannedAt: options.scannedAt,
        offline: options.offline,
        result,
      },
    });
    if (result === 'boarded' || result === 'already_boarded') {
      await this.audit.record({
        action: result === 'boarded' ? 'bus.ticket_boarded' : 'bus.ticket_scan_conflict',
        actorUserId: agent.userId,
        targetType: 'bus_ticket',
        targetId: ticket.id,
        context: agent.context,
        metadata: { tripId: ticket.tripId, offline: options.offline },
      });
    }
    return { result, reason: null, ticket: view(boardedAt) };
  }

  /** Scans an offline scanner stored, in the order they were made. */
  async sync(
    scans: readonly { qrPayload: string; scannedAt: string }[],
    agent: Agent,
  ): Promise<ScanResult[]> {
    const ordered = [...scans].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
    const results: ScanResult[] = [];
    for (const scan of ordered) {
      results.push(
        await this.scan(scan.qrPayload, agent, {
          offline: true,
          scannedAt: new Date(scan.scannedAt),
        }),
      );
    }
    return results;
  }

  async trips(userId: string, date: string): Promise<z.infer<typeof operatorTripListSchema>> {
    const trips = await this.prisma.busTrip.findMany({
      where: {
        departsAtLocal: { startsWith: date },
        route: { operator: { members: { some: { userId } } } },
      },
      include: {
        layout: { select: { seatCount: true } },
        route: { include: { operator: true, origin: true, destination: true } },
        _count: { select: { assignments: { where: { active: true } } } },
      },
      orderBy: { departsAt: 'asc' },
    });
    const boarded = await this.prisma.busTicket.groupBy({
      by: ['tripId'],
      where: { tripId: { in: trips.map((trip) => trip.id) }, status: 'boarded' },
      _count: { _all: true },
    });
    const boardedBy = new Map(boarded.map((row) => [row.tripId, row._count._all]));
    return {
      trips: trips.map((trip) => ({
        id: trip.id,
        operatorName: trip.route.operator.name,
        origin: trip.route.origin.name,
        destination: trip.route.destination.name,
        departsAtLocal: trip.departsAtLocal,
        status: trip.status,
        seatCount: trip.layout.seatCount,
        sold: trip._count.assignments,
        boarded: boardedBy.get(trip.id) ?? 0,
      })),
    };
  }

  /** Who boards a trip: for the operator's own agents only (404 for anyone else). */
  async manifest(userId: string, tripId: string): Promise<z.infer<typeof manifestSchema>> {
    const trip = await this.prisma.busTrip.findUnique({
      where: { id: tripId },
      include: { route: { select: { operatorId: true } } },
    });
    if (!trip || !(await this.isAgentOf(userId, trip.route.operatorId))) {
      throw new NotFoundException();
    }
    const tickets = await this.prisma.busTicket.findMany({
      where: { tripId, status: { not: 'void' } },
      orderBy: { seatNumber: 'asc' },
    });
    const passengers = await this.prisma.bookingPassenger.findMany({
      where: { id: { in: tickets.map((ticket) => ticket.passengerId) } },
      select: { id: true, givenNames: true, surname: true },
    });
    const names = new Map(passengers.map((row) => [row.id, `${row.givenNames} ${row.surname}`]));
    return {
      tripId,
      passengers: tickets
        .sort((a, b) => a.seatNumber.localeCompare(b.seatNumber, 'en', { numeric: true }))
        .map((ticket) => ({
          ticketId: ticket.id,
          seatNumber: ticket.seatNumber,
          passengerName: names.get(ticket.passengerId) ?? '',
          status: ticket.status,
          boardedAt: ticket.boardedAt?.toISOString() ?? null,
        })),
    };
  }

  private async isAgentOf(userId: string, operatorId: string): Promise<boolean> {
    const member = await this.prisma.operatorMember.findUnique({
      where: { operatorId_userId: { operatorId, userId } },
      select: { userId: true },
    });
    return member !== null;
  }
}
