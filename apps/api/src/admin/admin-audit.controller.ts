import { Controller, Get, Query } from '@nestjs/common';
import type { z } from 'zod';

import { AdminRoute } from '../auth/decorators';
import { Contract } from '../contract/contract';
import { PrismaService } from '../infra/prisma.service';

import { auditLogPageSchema, auditLogQuerySchema } from './admin.schemas';

@Controller('admin/audit-logs')
export class AdminAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @AdminRoute('audit:read')
  @Contract({
    operationId: 'adminListAuditLogs',
    summary: 'Browse the immutable audit log (newest first)',
    tags: ['Admin'],
    query: auditLogQuerySchema,
    responses: { 200: auditLogPageSchema },
    errors: [403],
  })
  async list(
    @Query() query: z.infer<typeof auditLogQuerySchema>,
  ): Promise<z.infer<typeof auditLogPageSchema>> {
    // UUIDv7 ids are time-ordered, so the id doubles as a stable keyset cursor.
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(query.action ? { action: query.action } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        actorType: row.actorType,
        actorUserId: row.actorUserId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        requestId: row.requestId,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
