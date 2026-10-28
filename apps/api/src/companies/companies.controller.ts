import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { requestContext } from '../common/request-context';
import { Contract, fileResponse } from '../contract/contract';
import { COMPANY_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import {
  acceptInvitationSchema,
  changeRoleSchema,
  companyBookingPageSchema,
  companyBookingParamsSchema,
  companyBookingQuerySchema,
  companyBookingSchema,
  companyInvitationSchema,
  companyMembersSchema,
  companySchema,
  companySpendQuerySchema,
  companySpendSchema,
  createCompanySchema,
  invitationParamsSchema,
  inviteMemberSchema,
  memberParamsSchema,
  myCompanySchema,
  rejectApprovalSchema,
  updateCompanySchema,
  updatePolicySchema,
} from './companies.schemas';
import { CompaniesService } from './companies.service';
import { CompanyTripsService } from './company-trips.service';

type CompanyView = z.infer<typeof companySchema>;
const TAGS = ['Companies'];

/**
 * Company accounts (ADR-078). Every route acts on the caller's own company: there is no company
 * id in the path, and member, invitation and booking ids are looked up inside it (404 otherwise).
 */
@Controller('me/company')
export class CompaniesController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly trips: CompanyTripsService,
  ) {}

  @Get()
  @Contract({
    operationId: 'getMyCompany',
    summary: 'The company the caller belongs to',
    description:
      '`company` is null when the caller belongs to no company (the other company routes answer 404 then).',
    tags: TAGS,
    responses: { 200: myCompanySchema },
  })
  async mine(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof myCompanySchema>> {
    const membership = await this.companies.membership(auth.userId);
    return { company: membership ? this.companies.present(membership) : null };
  }

  @Post()
  @RateLimit(COMPANY_LIMITS.createUser)
  @Contract({
    operationId: 'createCompany',
    audit: ['company.created'],
    summary: 'Create a company with the caller as its admin',
    description:
      'A person belongs to one company: 409 `company-member-exists` when the caller already does.',
    tags: TAGS,
    body: createCompanySchema,
    responses: { 201: companySchema },
    errors: [409],
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof createCompanySchema>,
    @Req() request: Request,
  ): Promise<CompanyView> {
    return this.companies.create(auth.userId, body, requestContext(request));
  }

  @Put()
  @Contract({
    operationId: 'updateCompany',
    audit: ['company.updated'],
    summary: "Change the company's details",
    description: 'Admins only (403 `company-admin-required`).',
    tags: TAGS,
    body: updateCompanySchema,
    responses: { 200: companySchema },
    errors: [403, 404],
  })
  update(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof updateCompanySchema>,
    @Req() request: Request,
  ): Promise<CompanyView> {
    return this.companies.update(auth.userId, body, requestContext(request));
  }

  @Put('policy')
  @Contract({
    operationId: 'setCompanyPolicy',
    audit: ['company.policy_updated'],
    summary: 'Set the travel policy',
    description:
      'Admins only. A field set to null does not apply. Applies to company trips booked from now on.',
    tags: TAGS,
    body: updatePolicySchema,
    responses: { 200: companySchema },
    errors: [403, 404],
  })
  setPolicy(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof updatePolicySchema>,
    @Req() request: Request,
  ): Promise<CompanyView> {
    return this.companies.setPolicy(auth.userId, body, requestContext(request));
  }

  @Get('members')
  @Contract({
    operationId: 'listCompanyMembers',
    summary: 'Members and open invitations',
    description: 'Email addresses and invitations are shown to admins only.',
    tags: TAGS,
    responses: { 200: companyMembersSchema },
    errors: [404],
  })
  members(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof companyMembersSchema>> {
    return this.companies.members(auth.userId);
  }

  @Post('invitations')
  @RateLimit(COMPANY_LIMITS.inviteUser)
  @Contract({
    operationId: 'inviteCompanyMember',
    audit: ['company.member_invited'],
    summary: 'Invite someone by email',
    description: `Admins only. Emails a single-use link valid for 7 days; accepting needs an account whose verified email is the invited one.`,
    tags: TAGS,
    body: inviteMemberSchema,
    responses: { 201: companyInvitationSchema },
    errors: [403, 404],
  })
  invite(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof inviteMemberSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof companyInvitationSchema>> {
    return this.companies.invite(auth.userId, body, requestContext(request));
  }

  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @RateLimit(COMPANY_LIMITS.acceptUser)
  @Contract({
    operationId: 'acceptCompanyInvitation',
    audit: ['company.member_joined'],
    summary: 'Join a company with an invitation',
    description:
      '400 `company-invitation-invalid` when the link expired, was used or withdrawn, or the account email is not the invited one (or not verified); 409 `company-member-exists` when the caller already belongs to a company.',
    tags: TAGS,
    body: acceptInvitationSchema,
    responses: { 200: companySchema },
    errors: [400, 409],
  })
  accept(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof acceptInvitationSchema>,
    @Req() request: Request,
  ): Promise<CompanyView> {
    return this.companies.accept(auth.userId, body.token, requestContext(request));
  }

  @Delete('invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Contract({
    operationId: 'revokeCompanyInvitation',
    audit: ['company.invitation_revoked'],
    summary: 'Withdraw an open invitation',
    tags: TAGS,
    params: invitationParamsSchema,
    responses: { 204: null },
    errors: [403, 404],
  })
  async revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('invitationId') invitationId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.companies.revokeInvitation(auth.userId, invitationId, requestContext(request));
  }

  @Put('members/:memberId/role')
  @Contract({
    operationId: 'changeCompanyMemberRole',
    audit: ['company.member_role_changed'],
    summary: "Change a member's role",
    description: 'Admins only. 409 `company-last-admin` when it would leave no admin.',
    tags: TAGS,
    params: memberParamsSchema,
    body: changeRoleSchema,
    responses: { 200: companyMembersSchema },
    errors: [403, 404, 409],
  })
  changeRole(
    @CurrentAuth() auth: AuthContext,
    @Param('memberId') memberId: string,
    @Body() body: z.output<typeof changeRoleSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof companyMembersSchema>> {
    return this.companies.changeRole(auth.userId, memberId, body.role, requestContext(request));
  }

  @Delete('members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Contract({
    operationId: 'removeCompanyMember',
    audit: ['company.member_removed', 'company.member_left'],
    summary: 'Remove a member, or leave the company',
    description:
      'Admins remove anyone; every member can remove themself (leave). 409 `company-last-admin` for the last admin. Company trips stay with the company.',
    tags: TAGS,
    params: memberParamsSchema,
    responses: { 204: null },
    errors: [403, 404, 409],
  })
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('memberId') memberId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.companies.removeMember(auth.userId, memberId, requestContext(request));
  }

  @Get('bookings')
  @Contract({
    operationId: 'listCompanyBookings',
    summary: 'Company trips',
    description:
      'Newest first. Admins and approvers see every company trip; bookers and travellers the ones they booked. `approval=pending` lists the trips waiting for a decision.',
    tags: TAGS,
    query: companyBookingQuerySchema,
    responses: { 200: companyBookingPageSchema },
    errors: [404],
  })
  bookings(
    @CurrentAuth() auth: AuthContext,
    @Query() query: z.infer<typeof companyBookingQuerySchema>,
  ): Promise<z.infer<typeof companyBookingPageSchema>> {
    return this.trips.list(auth.userId, query);
  }

  @Post('bookings/:bookingId/approve')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'approveCompanyTrip',
    audit: ['company.trip_approved'],
    summary: 'Approve a trip waiting for approval',
    description:
      'Approvers and admins, never for their own trip (403 `approval-own-trip`). The booker can then pay. 409 `approval-not-pending` when it was decided, paid, cancelled or expired.',
    tags: TAGS,
    params: companyBookingParamsSchema,
    responses: { 200: companyBookingSchema },
    errors: [403, 404, 409],
  })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId') bookingId: string,
    @Req() request: Request,
  ): Promise<z.infer<typeof companyBookingSchema>> {
    return this.trips.approve(auth.userId, bookingId, requestContext(request));
  }

  @Post('bookings/:bookingId/reject')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'rejectCompanyTrip',
    audit: ['company.trip_rejected', 'booking.status_changed'],
    summary: 'Reject a trip waiting for approval',
    description:
      'Approvers and admins, never for their own trip. Cancels the unpaid booking; the reason is a code, so no free text is stored.',
    tags: TAGS,
    params: companyBookingParamsSchema,
    body: rejectApprovalSchema,
    responses: { 200: companyBookingSchema },
    errors: [403, 404, 409],
  })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId') bookingId: string,
    @Body() body: z.output<typeof rejectApprovalSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof companyBookingSchema>> {
    return this.trips.reject(auth.userId, bookingId, body.reason, requestContext(request));
  }

  @Get('spend')
  @Contract({
    operationId: 'getCompanySpend',
    summary: 'Company spend by month and by traveller',
    description: 'Admins and approvers (403 `company-approver-required`).',
    tags: TAGS,
    query: companySpendQuerySchema,
    responses: { 200: companySpendSchema },
    errors: [403, 404],
  })
  spend(
    @CurrentAuth() auth: AuthContext,
    @Query() query: z.infer<typeof companySpendQuerySchema>,
  ): Promise<z.infer<typeof companySpendSchema>> {
    return this.trips.spend(auth.userId, query);
  }

  @Get('export')
  @RateLimit(COMPANY_LIMITS.exportUser)
  @Contract({
    operationId: 'exportCompanyBookings',
    summary: 'Company trips as CSV',
    description:
      'Admins and approvers. One row per trip booked in the range (newest 5,000): reference, dates, product, traveller, booker, status, approval, policy findings, currency and total in minor units. No contact or passport details.',
    tags: TAGS,
    query: companySpendQuerySchema,
    responses: { 200: fileResponse('text/csv') },
    errors: [403, 404],
  })
  async export(
    @CurrentAuth() auth: AuthContext,
    @Query() query: z.infer<typeof companySpendQuerySchema>,
  ): Promise<StreamableFile> {
    const { fileName, bytes } = await this.trips.csv(auth.userId, query);
    return new StreamableFile(bytes, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${fileName}"`,
      length: bytes.byteLength,
    });
  }
}
