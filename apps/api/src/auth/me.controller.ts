import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { AuditService } from '../audit/audit.service';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { AUTH_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import { CurrentAuth, type AuthContext } from './auth-context';
import {
  acceptedSchema,
  authUserSchema,
  changePasswordBodySchema,
  codeBodySchema,
  otpDispatchedSchema,
  phoneBodySchema,
  phoneVerifyBodySchema,
  reauthBodySchema,
  recoveryCodesSchema,
  sessionIdParamsSchema,
  sessionListSchema,
  totpConfirmBodySchema,
  totpSetupSchema,
  updateProfileBodySchema,
} from './auth.schemas';
import { AuthService } from './auth.service';
import { MfaService, type MfaProof } from './mfa.service';
import { OTP_RESEND_SECONDS, OTP_TTL_SECONDS } from './otp.service';
import { ReauthService } from './reauth.service';
import { SessionService } from './session.service';

const TAGS = ['Account'];
type AuthUser = z.infer<typeof authUserSchema>;

const toProof = (body: z.infer<typeof codeBodySchema>): MfaProof =>
  body.code !== undefined ? { code: body.code } : { recoveryCode: body.recoveryCode ?? '' };

/** The signed-in user's own account: profile, credentials, sessions and MFA. */
@Controller('me')
export class MeController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    private readonly reauth: ReauthService,
  ) {}

  @Get()
  @Contract({
    operationId: 'getMe',
    summary: 'The signed-in user',
    tags: TAGS,
    responses: { 200: authUserSchema },
  })
  getMe(@CurrentAuth() auth: AuthContext): Promise<AuthUser> {
    return this.auth.getUser(auth.userId);
  }

  @Patch()
  @Contract({
    operationId: 'updateMe',
    summary: 'Update profile details',
    tags: TAGS,
    body: updateProfileBodySchema,
    responses: { 200: authUserSchema },
  })
  updateMe(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof updateProfileBodySchema>,
  ): Promise<AuthUser> {
    return this.auth.updateProfile(auth.userId, body.displayName);
  }

  @Post('email/verification')
  @RateLimit(AUTH_LIMITS.sensitive)
  @HttpCode(HttpStatus.ACCEPTED)
  @Contract({
    operationId: 'resendEmailVerification',
    summary: 'Send the email verification link again',
    tags: TAGS,
    responses: { 202: acceptedSchema },
  })
  async resendEmailVerification(
    @CurrentAuth() auth: AuthContext,
  ): Promise<z.infer<typeof acceptedSchema>> {
    await this.auth.resendEmailVerification(auth.userId);
    return { status: 'accepted' };
  }

  @Post('password')
  @RateLimit(AUTH_LIMITS.sensitive)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Contract({
    operationId: 'changePassword',
    summary: 'Change the password',
    description: 'Signs out every other session.',
    tags: TAGS,
    body: changePasswordBodySchema,
    responses: { 204: null },
    errors: [409, 422],
  })
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof changePasswordBodySchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.changePassword(auth, body, requestContext(request));
  }

  @Post('phone')
  @RateLimit(AUTH_LIMITS.sensitive, AUTH_LIMITS.otpSendPhone)
  @HttpCode(HttpStatus.ACCEPTED)
  @Contract({
    operationId: 'requestPhoneVerification',
    summary: 'Text a code to add or change the phone number',
    tags: TAGS,
    body: phoneBodySchema,
    responses: { 202: otpDispatchedSchema },
    errors: [401],
  })
  async requestPhone(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof phoneBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof otpDispatchedSchema>> {
    // The number becomes a way to sign in and recover the account.
    await this.reauth.confirmRecent(auth, body.reauth, requestContext(request));
    await this.auth.requestPhoneVerification(auth.userId, body.phone);
    return {
      status: 'accepted',
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAfterSeconds: OTP_RESEND_SECONDS,
    };
  }

  @Post('phone/verify')
  @RateLimit(AUTH_LIMITS.sensitive)
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'verifyPhone',
    summary: 'Confirm the phone number with the texted code',
    tags: TAGS,
    body: phoneVerifyBodySchema,
    responses: { 200: authUserSchema },
    errors: [409],
  })
  verifyPhone(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof phoneVerifyBodySchema>,
    @Req() request: Request,
  ): Promise<AuthUser> {
    return this.auth.verifyPhone(auth.userId, body.phone, body.code, requestContext(request));
  }

  // --- Sessions / devices --------------------------------------------------------------

  @Get('sessions')
  @Contract({
    operationId: 'listSessions',
    summary: 'Signed-in devices',
    tags: TAGS,
    responses: { 200: sessionListSchema },
  })
  async listSessions(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof sessionListSchema>> {
    const sessions = await this.sessions.list(auth.userId, auth.sessionId);
    return {
      sessions: sessions.map((session) => ({
        ...session,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
      })),
    };
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Contract({
    operationId: 'revokeSession',
    summary: 'Sign out a device',
    tags: TAGS,
    params: sessionIdParamsSchema,
    body: reauthBodySchema,
    responses: { 204: null },
    errors: [401, 404],
  })
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof reauthBodySchema>,
    @Req() request: Request,
  ): Promise<void> {
    // Ownership check: another user's session id is indistinguishable from a missing one.
    if (!(await this.sessions.belongsTo(id, auth.userId))) throw new NotFoundException();
    // Signing out this device needs no proof; signing out another one does.
    if (id !== auth.sessionId) {
      await this.reauth.confirmRecent(auth, body.reauth, requestContext(request));
    }
    if (await this.sessions.revoke(id, 'user_revoked')) {
      await this.audit.record({
        action: 'auth.session.revoked',
        actorUserId: auth.userId,
        targetType: 'session',
        targetId: id,
        context: requestContext(request),
      });
    }
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Contract({
    operationId: 'revokeOtherSessions',
    summary: 'Sign out every other device',
    tags: TAGS,
    body: reauthBodySchema,
    responses: { 204: null },
    errors: [401],
  })
  async revokeOthers(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof reauthBodySchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.reauth.confirmRecent(auth, body.reauth, requestContext(request));
    const count = await this.sessions.revokeAllForUser(
      auth.userId,
      'user_revoked_others',
      auth.sessionId,
    );
    await this.audit.record({
      action: 'auth.sessions.revoked_all',
      actorUserId: auth.userId,
      context: requestContext(request),
      metadata: { count, keptCurrent: true },
    });
  }

  // --- MFA -----------------------------------------------------------------------------

  @Post('mfa/totp')
  @RateLimit(AUTH_LIMITS.sensitive)
  @Contract({
    operationId: 'startTotpEnrolment',
    summary: 'Start authenticator-app enrolment',
    tags: TAGS,
    body: reauthBodySchema,
    responses: { 201: totpSetupSchema },
    errors: [401, 409],
  })
  async startTotp(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof reauthBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof totpSetupSchema>> {
    // Enrolling someone else's authenticator would lock the owner out (ASVS V7.5.1).
    await this.reauth.confirmRecent(auth, body.reauth, requestContext(request));
    const user = await this.auth.getUser(auth.userId);
    return this.mfa.startEnrolment(auth.userId, user.email ?? user.phone ?? user.id);
  }

  @Post('mfa/totp/confirm')
  @RateLimit(AUTH_LIMITS.sensitive)
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'confirmTotpEnrolment',
    summary: 'Confirm enrolment with a code and receive recovery codes',
    description:
      'Marks the current session as MFA-verified; refresh the session to receive an access token that carries it.',
    tags: TAGS,
    body: totpConfirmBodySchema,
    responses: { 200: recoveryCodesSchema },
    errors: [401, 409],
  })
  async confirmTotp(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof totpConfirmBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof recoveryCodesSchema>> {
    const recoveryCodes = await this.mfa.confirmEnrolment(
      auth.userId,
      body.code,
      requestContext(request),
    );
    await this.sessions.markMfaVerified(auth.sessionId);
    return { recoveryCodes };
  }

  @Post('mfa/totp/disable')
  @RateLimit(AUTH_LIMITS.sensitive)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Contract({
    operationId: 'disableTotp',
    summary: 'Turn off MFA (not allowed for staff)',
    tags: TAGS,
    body: codeBodySchema,
    responses: { 204: null },
    errors: [401, 403],
  })
  async disableTotp(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof codeBodySchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.mfa.disable(auth.userId, auth.roles, toProof(body), requestContext(request));
  }

  @Post('mfa/recovery-codes')
  @RateLimit(AUTH_LIMITS.sensitive)
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'regenerateRecoveryCodes',
    summary: 'Replace all recovery codes',
    tags: TAGS,
    body: codeBodySchema,
    responses: { 200: recoveryCodesSchema },
    errors: [401],
  })
  async regenerateRecoveryCodes(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof codeBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof recoveryCodesSchema>> {
    const recoveryCodes = await this.mfa.regenerateRecoveryCodes(
      auth.userId,
      toProof(body),
      requestContext(request),
    );
    return { recoveryCodes };
  }
}
