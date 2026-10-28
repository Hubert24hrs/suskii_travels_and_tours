import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  BRAND,
  canManageCompany,
  COMPANY_INVITATION_DAYS,
  type CompanyInput,
  type CompanyInvitationInput,
  type CompanyRole,
  type TravelPolicyInput,
} from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/request-context';
import { maskEmail } from '../bookings/booking-codes';
import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { HmacService } from '../crypto/hmac.service';
import { randomToken } from '../crypto/random';
import type { Company, CompanyMember, CompanyPolicy, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { EmailProvider } from '../notifications/email';
import { simpleEmail } from '../notifications/templates';

import type {
  companyInvitationSchema,
  companyMembersSchema,
  companyPolicySchema,
  companySchema,
} from './companies.schemas';

type CompanyView = z.infer<typeof companySchema>;
type MembersView = z.infer<typeof companyMembersSchema>;
type InvitationView = z.infer<typeof companyInvitationSchema>;

const DAY_MS = 86_400_000;

export interface Membership {
  member: CompanyMember;
  company: Company & { policy: CompanyPolicy | null };
}

export const alreadyInCompany = () =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'company-member-exists',
    'You already belong to a company',
    'A person can belong to one company. Leave it first.',
  );
export const notCompanyAdmin = () =>
  new ProblemDetailsException(
    HttpStatus.FORBIDDEN,
    'company-admin-required',
    'Only a company admin can do this',
  );
export const lastAdmin = () =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'company-last-admin',
    'A company needs an admin',
    'Make another member an admin first.',
  );
export const invitationInvalid = () =>
  new ProblemDetailsException(
    HttpStatus.BAD_REQUEST,
    'company-invitation-invalid',
    'This invitation cannot be used',
    'It may have expired, been used or been withdrawn, or it was sent to another email address.',
  );

export function presentPolicy(row: CompanyPolicy | null): z.infer<typeof companyPolicySchema> {
  const cap = row?.hotelNightlyCapMinor ?? null;
  const currency = row?.hotelNightlyCurrency ?? null;
  return {
    hotelNightlyCap: cap !== null && currency ? { amountMinor: Number(cap), currency } : null,
    maxCabin: row?.maxCabin ?? null,
    minAdvanceDays: row?.minAdvanceDays ?? null,
    approvalMode: row?.approvalMode ?? 'never',
  };
}

const presentInvitation = (row: {
  id: string;
  emailHint: string;
  role: CompanyRole;
  expiresAt: Date;
  createdAt: Date;
}): InvitationView => ({
  id: row.id,
  emailHint: row.emailHint,
  role: row.role,
  expiresAt: row.expiresAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

/**
 * Company accounts (ADR-078): a company, its members and their roles, emailed invitations and
 * the travel policy. Every call resolves the caller's own membership first, so ids from the path
 * are only ever looked up inside the caller's company (anything else answers 404).
 */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hmac: HmacService,
    private readonly email: EmailProvider,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The caller's membership, or null when they belong to no company. */
  async membership(userId: string): Promise<Membership | null> {
    const member = await this.prisma.companyMember.findUnique({
      where: { userId },
      include: { company: { include: { policy: true } } },
    });
    if (!member) return null;
    const { company, ...rest } = member;
    return { member: rest, company };
  }

  async requireMembership(userId: string): Promise<Membership> {
    const found = await this.membership(userId);
    if (!found) throw new NotFoundException();
    return found;
  }

  private async requireAdmin(userId: string): Promise<Membership> {
    const found = await this.requireMembership(userId);
    if (!canManageCompany(found.member.role)) throw notCompanyAdmin();
    return found;
  }

  present({ member, company }: Membership): CompanyView {
    return {
      id: company.id,
      name: company.name,
      countryCode: company.countryCode,
      registrationNumber: company.registrationNumber,
      taxId: company.taxId,
      billingEmail: company.billingEmail,
      status: company.status,
      myRole: member.role,
      policy: presentPolicy(company.policy),
      createdAt: company.createdAt.toISOString(),
    };
  }

  async mine(userId: string): Promise<CompanyView> {
    return this.present(await this.requireMembership(userId));
  }

  /** Creates a company with the caller as its first admin. */
  async create(userId: string, input: CompanyInput, context: RequestContext): Promise<CompanyView> {
    if (await this.membership(userId)) throw alreadyInCompany();
    try {
      await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: { ...input, createdById: userId, policy: { create: {} } },
        });
        await tx.companyMember.create({ data: { companyId: company.id, userId, role: 'admin' } });
        await this.audit.record(
          {
            action: 'company.created',
            actorUserId: userId,
            targetType: 'company',
            targetId: company.id,
            context,
          },
          tx,
        );
      });
    } catch (error) {
      // Two creations at once: the unique membership keeps one.
      if ((error as { code?: string }).code === 'P2002') throw alreadyInCompany();
      throw error;
    }
    return this.mine(userId);
  }

  async update(userId: string, input: CompanyInput, context: RequestContext): Promise<CompanyView> {
    const { company } = await this.requireAdmin(userId);
    const fields = [
      'name',
      'countryCode',
      'registrationNumber',
      'taxId',
      'billingEmail',
    ] as const satisfies readonly (keyof CompanyInput)[];
    const changed = fields.filter((key) => input[key] !== company[key]);
    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({ where: { id: company.id }, data: input });
      await this.audit.record(
        {
          action: 'company.updated',
          actorUserId: userId,
          targetType: 'company',
          targetId: company.id,
          context,
          metadata: { fields: changed },
        },
        tx,
      );
    });
    return this.mine(userId);
  }

  async setPolicy(
    userId: string,
    input: TravelPolicyInput,
    context: RequestContext,
  ): Promise<CompanyView> {
    const { company } = await this.requireAdmin(userId);
    const data = {
      hotelNightlyCapMinor: input.hotelNightlyCap
        ? BigInt(input.hotelNightlyCap.amountMinor)
        : null,
      hotelNightlyCurrency: input.hotelNightlyCap?.currency ?? null,
      maxCabin: input.maxCabin,
      minAdvanceDays: input.minAdvanceDays,
      approvalMode: input.approvalMode,
    } satisfies Prisma.CompanyPolicyUncheckedUpdateInput;
    await this.prisma.$transaction(async (tx) => {
      await tx.companyPolicy.upsert({
        where: { companyId: company.id },
        create: { companyId: company.id, ...data },
        update: data,
      });
      await this.audit.record(
        {
          action: 'company.policy_updated',
          actorUserId: userId,
          targetType: 'company',
          targetId: company.id,
          context,
          metadata: { approvalMode: input.approvalMode },
        },
        tx,
      );
    });
    return this.mine(userId);
  }

  // -------------------------------------------------------------------------
  // Members and invitations
  // -------------------------------------------------------------------------

  async members(userId: string): Promise<MembersView> {
    const { member, company } = await this.requireMembership(userId);
    const admin = canManageCompany(member.role);
    const [rows, invitations] = await Promise.all([
      this.prisma.companyMember.findMany({
        where: { companyId: company.id },
        include: { user: { select: { displayName: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      admin
        ? this.prisma.companyInvitation.findMany({
            where: {
              companyId: company.id,
              acceptedAt: null,
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
    ]);
    return {
      members: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        name: row.user.displayName,
        email: admin ? row.user.email : null,
        role: row.role,
        joinedAt: row.createdAt.toISOString(),
      })),
      invitations: invitations.map(presentInvitation),
    };
  }

  /** Emails a single-use invitation; the token is stored as an HMAC only. */
  async invite(
    userId: string,
    input: CompanyInvitationInput,
    context: RequestContext,
  ): Promise<InvitationView> {
    const { company } = await this.requireAdmin(userId);
    const token = randomToken(32);
    const now = new Date();
    const invitation = await this.prisma.$transaction(async (tx) => {
      const row = await tx.companyInvitation.create({
        data: {
          companyId: company.id,
          emailHash: this.hmac.digest('company-invitation-email', input.email),
          emailHint: maskEmail(input.email),
          role: input.role,
          tokenHash: this.hmac.digest('company-invitation', token),
          invitedById: userId,
          expiresAt: new Date(now.getTime() + COMPANY_INVITATION_DAYS * DAY_MS),
        },
      });
      await this.audit.record(
        {
          action: 'company.member_invited',
          actorUserId: userId,
          targetType: 'company',
          targetId: company.id,
          context,
          metadata: { invitationId: row.id, role: input.role },
        },
        tx,
      );
      return row;
    });
    const url = `${this.config.WEB_APP_URL.replace(/\/$/, '')}/account/company/join#invite=${token}`;
    await this.email.send({
      to: input.email,
      template: 'company-invitation',
      ...simpleEmail(
        `Join ${company.name} on ${BRAND.name}`,
        `Join ${company.name}`,
        [
          `You have been invited to book travel for ${company.name} on ${BRAND.name}.`,
          `Sign in or create an account with this email address, then accept the invitation. It expires in ${COMPANY_INVITATION_DAYS} days.`,
        ],
        { label: 'Accept the invitation', url },
      ),
    });
    return presentInvitation(invitation);
  }

  async revokeInvitation(
    userId: string,
    invitationId: string,
    context: RequestContext,
  ): Promise<void> {
    const { company } = await this.requireAdmin(userId);
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.companyInvitation.updateMany({
        where: { id: invitationId, companyId: company.id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) throw new NotFoundException();
      await this.audit.record(
        {
          action: 'company.invitation_revoked',
          actorUserId: userId,
          targetType: 'company',
          targetId: company.id,
          context,
          metadata: { invitationId },
        },
        tx,
      );
    });
  }

  /**
   * Accepts an invitation for the signed-in caller, whose verified email must be the invited
   * one, so a forwarded link cannot add someone else.
   */
  async accept(userId: string, token: string, context: RequestContext): Promise<CompanyView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
    const invitation = await this.prisma.companyInvitation.findUnique({
      where: { tokenHash: this.hmac.digest('company-invitation', token) },
      include: { company: true },
    });
    const now = new Date();
    if (
      !invitation ||
      !user?.email ||
      !user.emailVerifiedAt ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= now ||
      !this.hmac.verify('company-invitation-email', user.email.toLowerCase(), invitation.emailHash)
    ) {
      throw invitationInvalid();
    }
    if (await this.membership(userId)) throw alreadyInCompany();
    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.companyInvitation.updateMany({
          where: { id: invitation.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: now },
        });
        if (claimed.count !== 1) throw invitationInvalid();
        await tx.companyMember.create({
          data: { companyId: invitation.companyId, userId, role: invitation.role },
        });
        await this.audit.record(
          {
            action: 'company.member_joined',
            actorUserId: userId,
            targetType: 'company',
            targetId: invitation.companyId,
            context,
            metadata: { invitationId: invitation.id, role: invitation.role },
          },
          tx,
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw alreadyInCompany();
      throw error;
    }
    return this.mine(userId);
  }

  /** Changes a member's role; the last admin cannot be demoted. */
  async changeRole(
    userId: string,
    memberId: string,
    role: CompanyRole,
    context: RequestContext,
  ): Promise<MembersView> {
    const { company } = await this.requireAdmin(userId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockMembers(tx, company.id);
      const target = await tx.companyMember.findFirst({
        where: { id: memberId, companyId: company.id },
      });
      if (!target) throw new NotFoundException();
      if (target.role === 'admin' && role !== 'admin')
        await this.assertAnotherAdmin(tx, company.id, target.id);
      await tx.companyMember.update({ where: { id: target.id }, data: { role } });
      await this.audit.record(
        {
          action: 'company.member_role_changed',
          actorUserId: userId,
          targetType: 'company',
          targetId: company.id,
          context,
          metadata: { memberId, from: target.role, to: role },
        },
        tx,
      );
    });
    return this.members(userId);
  }

  /** Removes a member (an admin removing someone, or anyone leaving); company trips stay. */
  async removeMember(userId: string, memberId: string, context: RequestContext): Promise<void> {
    const { member, company } = await this.requireMembership(userId);
    const leaving = member.id === memberId;
    if (!leaving && !canManageCompany(member.role)) throw notCompanyAdmin();
    await this.prisma.$transaction(async (tx) => {
      await this.lockMembers(tx, company.id);
      const target = await tx.companyMember.findFirst({
        where: { id: memberId, companyId: company.id },
      });
      if (!target) throw new NotFoundException();
      if (target.role === 'admin') await this.assertAnotherAdmin(tx, company.id, target.id);
      await tx.companyMember.delete({ where: { id: target.id } });
      await this.audit.record(
        {
          action: leaving ? 'company.member_left' : 'company.member_removed',
          actorUserId: userId,
          targetType: 'company',
          targetId: company.id,
          context,
          metadata: { memberId },
        },
        tx,
      );
    });
  }

  /** Serialises role changes within a company, so two admins cannot both step down at once. */
  private async lockMembers(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
  }

  private async assertAnotherAdmin(
    tx: Prisma.TransactionClient,
    companyId: string,
    exceptMemberId: string,
  ): Promise<void> {
    const others = await tx.companyMember.count({
      where: { companyId, role: 'admin', id: { not: exceptMemberId } },
    });
    if (others === 0) throw lastAdmin();
  }
}
