import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { phoneSchema, type Role } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { SessionService, userWithRoles, type UserWithRoles } from '../auth/session.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import { conflict, type StaffActor } from './admin-helpers';
import type { adminUserPageSchema, adminUserQuerySchema, adminUserSchema } from './admin.schemas';

type AdminUser = z.infer<typeof adminUserSchema>;
type Query = z.infer<typeof adminUserQuerySchema>;
type Page = z.infer<typeof adminUserPageSchema>;

/**
 * Accounts for staff (phase 10): search, disable and enable (signing the user out everywhere),
 * MFA reset (the user enrols again at the next sign-in) and roles. Nobody acts on their own
 * account.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async present(user: UserWithRoles): Promise<AdminUser> {
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

  async get(id: string): Promise<AdminUser> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: userWithRoles });
    if (!user) throw new NotFoundException();
    return this.present(user);
  }

  /** Email by prefix (case-insensitive), phone exactly, optionally staff only; newest first. */
  async list(query: Query): Promise<Page> {
    const phone = query.q ? phoneSchema.safeParse(query.q.replace(/[\s()-]/g, '')) : null;
    const where: Prisma.UserWhereInput = {
      ...(query.q
        ? phone?.success
          ? { phone: phone.data }
          : { email: { startsWith: query.q.trim().toLowerCase() } }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.staffOnly ? { roles: { some: { roleKey: { not: 'customer' } } } } : {}),
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
    };
    const rows = await this.prisma.user.findMany({
      where,
      include: userWithRoles,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: await Promise.all(page.map((user) => this.present(user))),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Replaces the roles and signs the user out everywhere so they apply at once. */
  async setRoles(id: string, requested: readonly Role[], staff: StaffActor): Promise<AdminUser> {
    if (id === staff.userId) {
      // Prevents locking out the last super admin, and self-escalation through a stolen session.
      throw conflict('cannot-change-own-roles', 'You cannot change your own roles');
    }
    const roles = [...new Set(requested)].sort();
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id }, include: userWithRoles });
      if (!user) throw new NotFoundException();
      const before = user.roles.map((role) => role.roleKey).sort();
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({
        data: roles.map((roleKey) => ({ userId: id, roleKey, grantedById: staff.userId })),
      });
      await this.audit.record(
        {
          action: 'rbac.roles.changed',
          actorUserId: staff.userId,
          targetType: 'user',
          targetId: id,
          context: staff.context,
          metadata: { before, after: roles },
        },
        tx,
      );
      return tx.user.findUniqueOrThrow({ where: { id }, include: userWithRoles });
    });
    await this.sessions.revokeAllForUser(id, 'roles_changed');
    return this.present(updated);
  }

  async setStatus(
    id: string,
    status: 'active' | 'disabled',
    staff: StaffActor,
  ): Promise<AdminUser> {
    if (id === staff.userId)
      throw conflict('cannot-change-own-account', 'You cannot change your own account');
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id }, include: userWithRoles });
      if (!user) throw new NotFoundException();
      if (user.status === 'deleted') throw conflict('user-deleted', 'This account was deleted');
      if (user.status === status) return user;
      if (status === 'disabled' && user.roles.some((role) => role.roleKey === 'super_admin')) {
        const others = await tx.user.count({
          where: {
            id: { not: id },
            status: 'active',
            roles: { some: { roleKey: 'super_admin' } },
          },
        });
        if (others === 0)
          throw conflict('last-super-admin', 'The last super admin cannot be disabled');
      }
      await tx.user.update({ where: { id }, data: { status } });
      await this.audit.record(
        {
          action: status === 'disabled' ? 'user.disabled' : 'user.enabled',
          actorUserId: staff.userId,
          targetType: 'user',
          targetId: id,
          context: staff.context,
          metadata: { before: user.status, after: status },
        },
        tx,
      );
      return tx.user.findUniqueOrThrow({ where: { id }, include: userWithRoles });
    });
    if (status === 'disabled') await this.sessions.revokeAllForUser(id, 'account_disabled');
    return this.present(updated);
  }

  /** Removes the authenticator and recovery codes and signs the user out; they enrol again. */
  async resetMfa(id: string, staff: StaffActor): Promise<AdminUser> {
    if (id === staff.userId)
      throw conflict('cannot-change-own-account', 'You cannot change your own account');
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id }, include: userWithRoles });
      if (!user) throw new NotFoundException();
      const factors = await tx.mfaFactor.deleteMany({ where: { userId: id } });
      if (factors.count === 0)
        throw conflict('mfa-not-enabled', 'This account has no authenticator');
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: id } });
      await this.audit.record(
        {
          action: 'user.mfa_reset',
          actorUserId: staff.userId,
          targetType: 'user',
          targetId: id,
          context: staff.context,
          metadata: {},
        },
        tx,
      );
      return user;
    });
    await this.sessions.revokeAllForUser(id, 'mfa_reset');
    return this.present(updated);
  }

  /** Ends every session of the account (lost device, suspected takeover); audited with the count. */
  async revokeSessions(id: string, staff: StaffActor): Promise<{ revoked: number }> {
    if (id === staff.userId)
      throw conflict('cannot-change-own-account', 'You cannot change your own account');
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundException();
    const revoked = await this.sessions.revokeAllForUser(id, 'staff_revoked');
    await this.audit.record({
      action: 'user.sessions_revoked',
      actorUserId: staff.userId,
      targetType: 'user',
      targetId: id,
      context: staff.context,
      metadata: { revoked },
    });
    return { revoked };
  }
}
