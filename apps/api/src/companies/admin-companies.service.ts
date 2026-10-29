import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import type { CompanyStatus } from '@suskii/shared';

import { conflict, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import type {
  adminCompanyDetailSchema,
  adminCompanyPageSchema,
  adminCompanyQuerySchema,
  adminCompanySchema,
} from './companies.schemas';
import { presentPolicy } from './companies.service';
import { CompanyWalletService } from './company-wallet.service';

type AdminCompany = z.infer<typeof adminCompanySchema>;

const COUNTS = { _count: { select: { members: true, bookings: true } } } as const;

type CompanyRow = Prisma.CompanyGetPayload<{ include: typeof COUNTS }>;

const present = (row: CompanyRow): AdminCompany => ({
  id: row.id,
  name: row.name,
  countryCode: row.countryCode,
  registrationNumber: row.registrationNumber,
  taxId: row.taxId,
  billingEmail: row.billingEmail,
  status: row.status,
  members: row._count.members,
  bookings: row._count.bookings,
  createdAt: row.createdAt.toISOString(),
});

/** Companies in the console (ADR-078): staff read them and suspend or reinstate them. */
@Injectable()
export class AdminCompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly wallet: CompanyWalletService,
  ) {}

  async list(
    query: z.infer<typeof adminCompanyQuerySchema>,
  ): Promise<z.infer<typeof adminCompanyPageSchema>> {
    const rows = await this.prisma.company.findMany({
      where: {
        ...(query.q ? { name: { startsWith: query.q, mode: 'insensitive' } } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: COUNTS,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(present),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(id: string): Promise<z.infer<typeof adminCompanyDetailSchema>> {
    const row = await this.prisma.company.findUnique({
      where: { id },
      include: {
        ...COUNTS,
        policy: true,
        members: {
          include: { user: { select: { displayName: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!row) throw new NotFoundException();
    return {
      ...present(row),
      policy: presentPolicy(row.policy),
      ...(await this.wallet.forConsole(row.id)),
      memberList: row.members.map((member) => ({
        userId: member.userId,
        name: member.user.displayName,
        email: member.user.email,
        role: member.role,
        joinedAt: member.createdAt.toISOString(),
      })),
    };
  }

  /** Suspending stops company bookings; members keep their own accounts and trips. */
  async setStatus(
    id: string,
    status: CompanyStatus,
    staff: StaffActor,
  ): Promise<z.infer<typeof adminCompanyDetailSchema>> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.company.findUnique({ where: { id }, select: { status: true } });
      if (!current) throw new NotFoundException();
      if (current.status === status) {
        throw conflict(
          status === 'suspended' ? 'company-already-suspended' : 'company-already-active',
          status === 'suspended' ? 'The company is already suspended' : 'The company is active',
        );
      }
      await tx.company.update({ where: { id }, data: { status } });
      await this.audit.record(
        {
          action: status === 'suspended' ? 'company.suspended' : 'company.reinstated',
          actorUserId: staff.userId,
          targetType: 'company',
          targetId: id,
          context: staff.context,
        },
        tx,
      );
    });
    return this.get(id);
  }
}
