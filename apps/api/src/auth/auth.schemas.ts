import { z } from 'zod';

import {
  authTransportSchema,
  displayNameSchema,
  emailSchema,
  loginRequestSchema,
  otpCodeSchema,
  PASSWORD_MAX_LENGTH,
  passwordSchema,
  phoneSchema,
  referralCodeInputSchema,
  registerRequestSchema,
  ROLES,
} from '@suskii/shared';

import { named } from '../contract/contract';

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const timestamp = z.iso.datetime();

export const authUserSchema = named(
  'AuthUser',
  z.object({
    id: z.uuid(),
    email: z.email().nullable(),
    emailVerified: z.boolean(),
    phone: z.string().nullable(),
    phoneVerified: z.boolean(),
    displayName: z.string().nullable(),
    roles: z.array(z.enum(ROLES)),
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
  }),
);
export type AuthUserDto = z.infer<typeof authUserSchema>;

export const authSessionSchema = named(
  'AuthSession',
  z
    .object({
      status: z.literal('authenticated'),
      user: authUserSchema,
      sessionId: z.uuid(),
      accessTokenExpiresAt: timestamp,
      refreshTokenExpiresAt: timestamp,
      accessToken: z.string().optional().meta({ description: 'Token transport only.' }),
      refreshToken: z.string().optional().meta({ description: 'Token transport only.' }),
      csrfToken: z
        .string()
        .optional()
        .meta({ description: 'Cookie transport only: send it back in X-CSRF-Token.' }),
    })
    .meta({
      description:
        'Cookie transport sets httpOnly session cookies and returns the CSRF token; token transport returns the tokens in the body for secure storage.',
    }),
);
export type AuthSessionDto = z.infer<typeof authSessionSchema>;

export const mfaChallengeSchema = named(
  'MfaChallenge',
  z.object({
    status: z.literal('mfa_required'),
    mfaToken: z.string(),
    expiresAt: timestamp,
    methods: z.array(z.enum(['totp', 'recovery_code'])),
  }),
);
export type MfaChallengeDto = z.infer<typeof mfaChallengeSchema>;

export const signInResultSchema = named(
  'SignInResult',
  z.discriminatedUnion('status', [authSessionSchema, mfaChallengeSchema]),
);

export const acceptedSchema = named(
  'Accepted',
  z.object({ status: z.literal('accepted') }).meta({
    description: 'The request was accepted. The outcome is not disclosed (account privacy).',
  }),
);

export const otpDispatchedSchema = named(
  'OtpDispatched',
  z.object({
    status: z.literal('accepted'),
    expiresInSeconds: z.number().int(),
    resendAfterSeconds: z.number().int(),
  }),
);

export const jwksSchema = named(
  'Jwks',
  z.object({
    keys: z.array(
      z.looseObject({
        kty: z.string(),
        kid: z.string(),
        alg: z.string(),
        use: z.literal('sig'),
        crv: z.string().optional(),
        x: z.string().optional(),
      }),
    ),
  }),
);

export const sessionSummarySchema = named(
  'SessionSummary',
  z.object({
    id: z.uuid(),
    authMethod: z.enum(['password', 'otp', 'google', 'apple']),
    userAgent: z.string().nullable(),
    createdAt: timestamp,
    lastSeenAt: timestamp,
    mfaVerified: z.boolean(),
    current: z.boolean(),
  }),
);

export const sessionListSchema = named(
  'SessionList',
  z.object({ sessions: z.array(sessionSummarySchema) }),
);

export const totpSetupSchema = named(
  'TotpSetup',
  z.object({
    secret: z.string().meta({ description: 'Base32 secret for manual entry.' }),
    otpauthUri: z.string().meta({ description: 'Render as a QR code.' }),
  }),
);

export const recoveryCodesSchema = named(
  'RecoveryCodes',
  z.object({
    recoveryCodes: z
      .array(z.string())
      .meta({ description: 'Shown once. Each code works a single time.' }),
  }),
);

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const transport = authTransportSchema.default('token');

export const registerBodySchema = named('RegisterRequest', registerRequestSchema);
export const loginBodySchema = named('LoginRequest', loginRequestSchema);

export const refreshBodySchema = named(
  'RefreshRequest',
  z.object({
    refreshToken: z
      .string()
      .max(256)
      .optional()
      .meta({ description: 'Token transport. Omit to use the refresh cookie (cookie transport).' }),
  }),
);

export const logoutBodySchema = named(
  'LogoutRequest',
  z.object({ refreshToken: z.string().max(256).optional() }),
);

export const mfaVerifyBodySchema = named(
  'MfaVerifyRequest',
  z
    .object({
      mfaToken: z.string().min(1).max(256),
      code: otpCodeSchema.optional(),
      recoveryCode: z.string().min(1).max(32).optional(),
      transport,
    })
    .refine((value) => (value.code === undefined) !== (value.recoveryCode === undefined), {
      message: 'Send either code or recoveryCode',
      path: ['code'],
    }),
);

export const otpRequestBodySchema = named('OtpRequest', z.object({ phone: phoneSchema }));

export const otpVerifyBodySchema = named(
  'OtpVerifyRequest',
  z.object({
    phone: phoneSchema,
    code: otpCodeSchema,
    transport,
    referralCode: referralCodeInputSchema
      .optional()
      .meta({ description: 'Counts only when this code creates the account (ADR-031).' }),
  }),
);

export const socialSignInBodySchema = named(
  'SocialSignInRequest',
  z.object({
    idToken: z.string().min(1).max(8192),
    nonce: z.string().min(1).max(256).optional().meta({
      description: 'Raw nonce the client passed to the provider; checked against the token.',
    }),
    displayName: displayNameSchema
      .optional()
      .meta({ description: 'Apple shares the name only on first sign-in, outside the token.' }),
    transport,
    referralCode: referralCodeInputSchema
      .optional()
      .meta({ description: 'Counts only when this sign-in creates the account (ADR-031).' }),
  }),
);

export const tokenBodySchema = named(
  'VerificationTokenRequest',
  z.object({ token: z.string().min(1).max(256) }),
);

export const forgotPasswordBodySchema = named(
  'ForgotPasswordRequest',
  z.object({ email: emailSchema }),
);

export const resetPasswordBodySchema = named(
  'ResetPasswordRequest',
  z.object({ token: z.string().min(1).max(256), password: passwordSchema }),
);

export const changePasswordBodySchema = named(
  'ChangePasswordRequest',
  z.object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
  }),
);

export const updateProfileBodySchema = named(
  'UpdateProfileRequest',
  z.object({ displayName: displayNameSchema }),
);

export const codeBodySchema = named(
  'MfaCodeRequest',
  z
    .object({
      code: otpCodeSchema.optional(),
      recoveryCode: z.string().min(1).max(32).optional(),
    })
    .refine((value) => (value.code === undefined) !== (value.recoveryCode === undefined), {
      message: 'Send either code or recoveryCode',
      path: ['code'],
    }),
);

export const totpConfirmBodySchema = named('TotpConfirmRequest', z.object({ code: otpCodeSchema }));

export const phoneVerifyBodySchema = named(
  'PhoneVerifyRequest',
  z.object({ phone: phoneSchema, code: otpCodeSchema }),
);

export const sessionIdParamsSchema = z.object({ id: z.uuid() });

// ---------------------------------------------------------------------------
// Re-authentication for data export and account deletion (ADR-029)
// ---------------------------------------------------------------------------

export const REAUTH_METHODS = ['password', 'sms_code', 'recent_sign_in'] as const;

export const reauthRequirementsSchema = named(
  'ReauthRequirements',
  z.object({
    method: z
      .enum(REAUTH_METHODS)
      .describe(
        '`password`: send the account password; `sms_code`: request a code with `sendReauthCode`, then send it; `recent_sign_in`: sign in again (Google or Apple) and retry within the window.',
      ),
    mfa: z.boolean().describe('Also send `mfaCode` or `recoveryCode`.'),
    recentSignInMinutes: z.number().int().positive(),
  }),
);

/** The proof sent with an export or deletion request; which fields apply depends on the account. */
export const reauthProofSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH).optional(),
  code: otpCodeSchema.optional().describe('The texted code, for accounts without a password.'),
  mfaCode: otpCodeSchema.optional(),
  recoveryCode: z.string().min(1).max(32).optional(),
});
export type ReauthProof = z.infer<typeof reauthProofSchema>;

const reauthField = reauthProofSchema
  .optional()
  .describe(
    'Needed unless the session signed in within the last few minutes; the API answers 401 `reauthentication-required` with the method to use.',
  );

/** Changes to how the account signs in (ASVS 5.0 V7.5.1, V7.5.2). */
export const reauthBodySchema = named('ReauthRequest', z.object({ reauth: reauthField }));

export const phoneBodySchema = named(
  'PhoneRequest',
  z.object({ phone: phoneSchema, reauth: reauthField }),
);
