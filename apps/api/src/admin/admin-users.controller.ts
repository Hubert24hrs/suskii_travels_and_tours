import {
  Body,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { AuditService } from '../audit/audit.service';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { SessionService, userWithRoles, type UserWithRoles } from '../auth/session.service';
import { ProblemDetailsException } from '../common/problem-details';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { PrismaService } from '../infra/prisma.service';

import { adminUserSchema, setRolesBodySchema, userIdParamsSchema } from './admin.schemas';

type AdminUser = z.infer<typeof adminUserSchema>;
const TAGS = ['Admin'];

@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  private async present(user: UserWithRoles): Promise<AdminUser> {
    const factor = await this.prisma.mfaFactor.findUnique({
      where: { userId_type: { userId: user.id, type: 'totp' } },
      select: { confirmedAt: true },
    });
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      status: user.status,
      roles: user.roles.map((role) => role.roleKey),
      mfaEnabled: Boolean(factor?.confirmedAt),
      createdAt: user.createdAt.toISOString(),
    };
  }

  @Get(':id')
  @AdminRoute('users:read')
  @Contract({
    operationId: 'adminGetUser',
    summary: 'Get a user',
    tags: TAGS,
    params: userIdParamsSchema,
    responses: { 200: adminUserSchema },
    errors: [403, 404],
  })
  async getUser(@Param('id') id: string): Promise<AdminUser> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: userWithRoles });
    if (!user) throw new NotFoundException();
    return this.present(user);
  }

  @Put(':id/roles')
  @AdminRoute('roles:manage')
  @Contract({
    operationId: 'adminSetUserRoles',
    summary: "Replace a user's roles",
    description: 'Audited. Signs the user out everywhere so the new roles apply immediately.',
    tags: TAGS,
    params: userIdParamsSchema,
    body: setRolesBodySchema,
    responses: { 200: adminUserSchema },
    errors: [403, 404, 409],
  })
  async setRoles(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof setRolesBodySchema>,
    @Req() request: Request,
  ): Promise<AdminUser> {
    if (id === auth.userId) {
      // Prevents locking out the last super admin, and self-escalation through a stolen session.
      throw new ProblemDetailsException(
        HttpStatus.CONFLICT,
        'cannot-change-own-roles',
        'You cannot change your own roles',
      );
    }
    const roles = [...new Set(body.roles)].sort();
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id }, include: userWithRoles });
      if (!user) throw new NotFoundException();
      const before = user.roles.map((role) => role.roleKey).sort();
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({
        data: roles.map((roleKey) => ({ userId: id, roleKey, grantedById: auth.userId })),
      });
      await this.audit.record(
        {
          action: 'rbac.roles.changed',
          actorUserId: auth.userId,
          targetType: 'user',
          targetId: id,
          context: requestContext(request),
          metadata: { before, after: roles },
        },
        tx,
      );
      return tx.user.findUniqueOrThrow({ where: { id }, include: userWithRoles });
    });
    await this.sessions.revokeAllForUser(id, 'roles_changed');
    return this.present(updated);
  }
}
