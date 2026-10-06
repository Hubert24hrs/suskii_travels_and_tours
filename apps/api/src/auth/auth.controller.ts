import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import { DeviceAttested } from '../attestation/attestation.guard';
import { ATTESTATION_HEADER } from '../attestation/attestation.schemas';
import { AuditService } from '../audit/audit.service';
import { botCheckFailed } from '../bot-protection/errors';
import { TurnstileVerifier } from '../bot-protection/turnstile';
import { requestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Contract } from '../contract/contract';
import { AUTH_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';
import { clientContext } from '../search/client-context';

import type { AuthenticatedRequest } from './auth-context';
import { presentSession, presentSignIn } from './auth.presenter';
import {
  acceptedSchema,
  authSessionSchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  logoutBodySchema,
  mfaVerifyBodySchema,
  otpDispatchedSchema,
  otpRequestBodySchema,
  otpVerifyBodySchema,
  refreshBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
  signInResultSchema,
  socialNonceSchema,
  socialSignInBodySchema,
  tokenBodySchema,
} from './auth.schemas';
import { AuthService } from './auth.service';
import { clearSessionCookies, readCookie, sessionCookieNames } from './cookies';
import { CsrfService } from './csrf.service';
import { Public } from './decorators';
import { csrfFailed, invalidToken } from './errors';
import { MfaService } from './mfa.service';
import { OTP_RESEND_SECONDS, OTP_TTL_SECONDS } from './otp.service';
import { SessionService } from './session.service';
import { SocialNonces } from './social.service';

const TAGS = ['Auth'];
type Accepted = z.infer<typeof acceptedSchema>;

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly csrf: CsrfService,
    private readonly audit: AuditService,
    private readonly nonces: SocialNonces,
    private readonly turnstile: TurnstileVerifier,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('register')
  @RateLimit(AUTH_LIMITS.register)
  @DeviceAttested('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @Contract({
    operationId: 'register',
    summary: 'Create an account with email and password',
    description:
      'Always answers 202 so the response never reveals whether the email is registered. New accounts get a verification email; existing ones get a notice. Sign in afterwards.',
    tags: TAGS,
    headers: [ATTESTATION_HEADER],
    body: registerBodySchema,
    responses: { 202: acceptedSchema },
    errors: [403, 422],
  })
  async register(
    @Body() body: z.infer<typeof registerBodySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<Accepted> {
    const context = requestContext(request);
    // Bots are turned away before any password or account check. The app proves itself with a
    // device attestation (AttestationGuard); everything else needs Turnstile.
    if (clientContext(request).channel !== 'mobile') {
      const verified =
        body.turnstileToken !== undefined &&
        (await this.turnstile.verify(body.turnstileToken, {
          remoteIp: context.ip,
          action: 'register',
        }));
      if (!verified) throw botCheckFailed();
    }
    const { turnstileToken: _token, ...input } = body;
    await this.auth.register(input, context);
    return { status: 'accepted' };
  }

  @Post('login')
  @RateLimit(AUTH_LIMITS.login)
  @DeviceAttested('login')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'login',
    summary: 'Sign in with email and password',
    description: 'Returns a session, or an MFA challenge when the account has MFA enabled.',
    tags: TAGS,
    headers: [ATTESTATION_HEADER],
    body: loginBodySchema,
    responses: { 200: signInResultSchema },
    errors: [401, 403],
  })
  async login(
    @Body() body: z.infer<typeof loginBodySchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const outcome = await this.auth.login(body, requestContext(request));
    return presentSignIn(outcome, body.transport, response, this.config);
  }

  @Post('mfa/verify')
  @RateLimit(AUTH_LIMITS.mfa)
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'verifyMfa',
    summary: 'Complete a sign-in with a TOTP or recovery code',
    tags: TAGS,
    body: mfaVerifyBodySchema,
    responses: { 200: authSessionSchema },
    errors: [401],
  })
  async verifyMfa(
    @Body() body: z.infer<typeof mfaVerifyBodySchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const proof =
      body.code !== undefined ? { code: body.code } : { recoveryCode: body.recoveryCode ?? '' };
    const outcome = await this.auth.verifyMfa(body.mfaToken, proof, requestContext(request));
    return presentSignIn(outcome, body.transport, response, this.config);
  }

  @Post('refresh')
  @RateLimit(AUTH_LIMITS.refresh)
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'refreshSession',
    summary: 'Rotate the refresh token and get a new access token',
    description:
      'Every refresh token works once. Presenting a used token again revokes the whole session (theft detection). Cookie transport also requires X-CSRF-Token.',
    tags: TAGS,
    body: refreshBodySchema,
    responses: { 200: authSessionSchema },
    errors: [401, 403],
  })
  async refresh(
    @Body() body: z.infer<typeof refreshBodySchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const cookieToken = readCookie(request, sessionCookieNames(this.config).refresh);
    const transport = body.refreshToken ? 'token' : 'cookie';
    const raw = body.refreshToken ?? cookieToken;
    if (!raw) throw invalidToken();
    if (transport === 'cookie') await this.assertCsrfForRefreshToken(raw, request);
    try {
      const session = await this.sessions.rotate(raw, requestContext(request));
      const mfaEnabled = await this.mfa.isEnabled(session.user.id);
      return presentSession(session, mfaEnabled, transport, response, this.config);
    } catch (error) {
      if (transport === 'cookie') clearSessionCookies(response, this.config);
      throw error;
    }
  }

  @Post('logout')
  @RateLimit(AUTH_LIMITS.refresh)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Contract({
    operationId: 'logout',
    summary: 'Sign out this session',
    description:
      'Revokes the session identified by the access token, the refresh token in the body, or the refresh cookie (with X-CSRF-Token). Always succeeds.',
    tags: TAGS,
    body: logoutBodySchema,
    responses: { 204: null },
    errors: [403],
  })
  async logout(
    @Body() body: z.infer<typeof logoutBodySchema>,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    let sessionId = request.auth?.sessionId ?? null;
    let userId = request.auth?.userId ?? null;
    if (!sessionId) {
      const cookieToken = readCookie(request, sessionCookieNames(this.config).refresh);
      const raw = body.refreshToken ?? cookieToken;
      if (raw && !body.refreshToken) await this.assertCsrfForRefreshToken(raw, request);
      sessionId = raw ? await this.sessions.sessionIdForRefreshToken(raw) : null;
    }
    if (sessionId && (await this.sessions.revoke(sessionId, 'logout'))) {
      userId ??= await this.sessions.ownerOf(sessionId);
      await this.audit.record({
        action: 'auth.logout',
        actorUserId: userId,
        targetType: 'session',
        targetId: sessionId,
        context: requestContext(request),
      });
    }
    clearSessionCookies(response, this.config);
  }

  private async assertCsrfForRefreshToken(raw: string, request: Request): Promise<void> {
    const sessionId = await this.sessions.sessionIdForRefreshToken(raw);
    const header = request.headers['x-csrf-token'];
    const token = Array.isArray(header) ? header[0] : header;
    if (sessionId && !this.csrf.verify(sessionId, token)) throw csrfFailed();
  }

  @Post('otp/request')
  @RateLimit(AUTH_LIMITS.otpSendIp, AUTH_LIMITS.otpSendPhone)
  @HttpCode(HttpStatus.ACCEPTED)
  @Contract({
    operationId: 'requestSignInOtp',
    summary: 'Text a 6-digit sign-in code to a phone number',
    description: 'Codes expire after 5 minutes; a new code can be requested every 60 seconds.',
    tags: TAGS,
    body: otpRequestBodySchema,
    responses: { 202: otpDispatchedSchema },
  })
  async requestOtp(
    @Body() body: z.infer<typeof otpRequestBodySchema>,
  ): Promise<z.infer<typeof otpDispatchedSchema>> {
    await this.auth.requestSignInCode(body.phone);
    return {
      status: 'accepted',
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAfterSeconds: OTP_RESEND_SECONDS,
    };
  }

  @Post('otp/verify')
  @RateLimit(AUTH_LIMITS.otpVerify)
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'verifySignInOtp',
    summary: 'Sign in (or sign up) with a phone code',
    tags: TAGS,
    body: otpVerifyBodySchema,
    responses: { 200: signInResultSchema },
    errors: [401],
  })
  async verifyOtp(
    @Body() body: z.infer<typeof otpVerifyBodySchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const outcome = await this.auth.verifySignInCode(
      body.phone,
      body.code,
      requestContext(request),
      body.referralCode,
    );
    return presentSignIn(outcome, body.transport, response, this.config);
  }

  @Post('social/nonce')
  @RateLimit(AUTH_LIMITS.social)
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'createSocialNonce',
    summary: 'Get a single-use nonce for Google or Apple sign-in',
    description:
      'Pass it to the provider (Apple: its SHA-256 hex digest) and send it back with the ID token within 10 minutes. Sign-in refuses tokens without an unused nonce from here.',
    tags: TAGS,
    responses: { 200: socialNonceSchema },
  })
  async socialNonce(): Promise<z.infer<typeof socialNonceSchema>> {
    const { nonce, expiresAt } = await this.nonces.issue();
    return { nonce, expiresAt: expiresAt.toISOString() };
  }

  @Post('google')
  @RateLimit(AUTH_LIMITS.social)
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'signInWithGoogle',
    summary: 'Sign in with a Google ID token',
    tags: TAGS,
    body: socialSignInBodySchema,
    responses: { 200: signInResultSchema },
    errors: [401, 404],
  })
  async google(
    @Body() body: z.infer<typeof socialSignInBodySchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const outcome = await this.auth.socialSignIn('google', body, requestContext(request));
    return presentSignIn(outcome, body.transport, response, this.config);
  }

  @Post('apple')
  @RateLimit(AUTH_LIMITS.social)
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'signInWithApple',
    summary: 'Sign in with an Apple identity token',
    tags: TAGS,
    body: socialSignInBodySchema,
    responses: { 200: signInResultSchema },
    errors: [401, 404],
  })
  async apple(
    @Body() body: z.infer<typeof socialSignInBodySchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const outcome = await this.auth.socialSignIn('apple', body, requestContext(request));
    return presentSignIn(outcome, body.transport, response, this.config);
  }

  @Post('email/verify')
  @RateLimit(AUTH_LIMITS.verifyEmail)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Contract({
    operationId: 'verifyEmail',
    summary: 'Confirm an email address with the emailed token',
    tags: TAGS,
    body: tokenBodySchema,
    responses: { 204: null },
  })
  async verifyEmail(
    @Body() body: z.infer<typeof tokenBodySchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.verifyEmail(body.token, requestContext(request));
  }

  @Post('password/forgot')
  @RateLimit(AUTH_LIMITS.resetIp, AUTH_LIMITS.resetEmail)
  @HttpCode(HttpStatus.ACCEPTED)
  @Contract({
    operationId: 'forgotPassword',
    summary: 'Email a password reset link',
    description: 'Always answers 202, whether or not the email is registered.',
    tags: TAGS,
    body: forgotPasswordBodySchema,
    responses: { 202: acceptedSchema },
  })
  forgotPassword(@Body() body: z.infer<typeof forgotPasswordBodySchema>): Accepted {
    this.auth.forgotPassword(body.email);
    return { status: 'accepted' };
  }

  @Post('password/reset')
  @RateLimit(AUTH_LIMITS.resetIp)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Contract({
    operationId: 'resetPassword',
    summary: 'Set a new password with the emailed token',
    description: 'Signs the account out on every device.',
    tags: TAGS,
    body: resetPasswordBodySchema,
    responses: { 204: null },
    errors: [422],
  })
  async resetPassword(
    @Body() body: z.infer<typeof resetPasswordBodySchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.resetPassword(body.token, body.password, requestContext(request));
  }
}
