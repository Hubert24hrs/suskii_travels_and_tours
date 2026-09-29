import { createHash } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { safeEqual } from '../crypto/random';

import { invalidToken } from './errors';

export type SocialProviderName = 'google' | 'apple';

/** Key resolvers per provider; tests inject local key sets instead of the remote JWKS. */
export const SOCIAL_KEY_RESOLVERS = Symbol('SOCIAL_KEY_RESOLVERS');
export type SocialKeyResolvers = Record<SocialProviderName, JWTVerifyGetKey>;

export const PROVIDERS: Record<SocialProviderName, { issuers: string[]; jwksUrl: string }> = {
  google: {
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
  },
  apple: {
    issuers: ['https://appleid.apple.com'],
    jwksUrl: 'https://appleid.apple.com/auth/keys',
  },
};

export function remoteKeyResolvers(): SocialKeyResolvers {
  return {
    google: createRemoteJWKSet(new URL(PROVIDERS.google.jwksUrl)),
    apple: createRemoteJWKSet(new URL(PROVIDERS.apple.jwksUrl)),
  };
}

const claimsSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().optional(),
  // Apple sends "true"/"false" strings; Google sends booleans.
  email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  name: z.string().max(200).optional(),
  nonce: z.string().optional(),
});

export interface VerifiedSocialIdentity {
  provider: SocialProviderName;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** Verifies Google and Apple ID tokens: signature (provider JWKS), issuer, audience, expiry, nonce. */
@Injectable()
export class SocialIdentityVerifier {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SOCIAL_KEY_RESOLVERS) private readonly resolvers: SocialKeyResolvers,
  ) {}

  private audiences(provider: SocialProviderName): string[] {
    return provider === 'google' ? this.config.GOOGLE_CLIENT_IDS : this.config.APPLE_CLIENT_IDS;
  }

  async verify(
    provider: SocialProviderName,
    idToken: string,
    nonce?: string,
  ): Promise<VerifiedSocialIdentity> {
    const audience = this.audiences(provider);
    if (audience.length === 0) {
      throw new ProblemDetailsException(
        HttpStatus.NOT_FOUND,
        'social-provider-disabled',
        'Sign-in provider not enabled',
      );
    }
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(idToken, this.resolvers[provider], {
        issuer: PROVIDERS[provider].issuers,
        audience,
        algorithms: ['RS256', 'ES256'],
        clockTolerance: 30,
      }));
    } catch {
      throw invalidToken();
    }
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) throw invalidToken();
    if (nonce !== undefined) {
      // Google echoes the raw nonce; Apple native flows carry its SHA-256 hex digest.
      const hashed = createHash('sha256').update(nonce).digest('hex');
      const actual = claims.data.nonce ?? '';
      if (!safeEqual(actual, nonce) && !safeEqual(actual, hashed)) throw invalidToken();
    }
    const emailVerified =
      claims.data.email_verified === true || claims.data.email_verified === 'true';
    return {
      provider,
      subject: claims.data.sub,
      email: claims.data.email?.toLowerCase() ?? null,
      emailVerified,
      name: claims.data.name ?? null,
    };
  }
}
