import { createHash } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { randomToken, safeEqual, sha256 } from '../crypto/random';
import { REDIS } from '../infra/redis';

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

/** How long a sign-in nonce waits for its ID token. */
export const SOCIAL_NONCE_TTL_SECONDS = 600;
const nonceKey = (nonce: string): string => `auth:social-nonce:${sha256(nonce)}`;

/**
 * Server-issued, single-use nonces for Google and Apple sign-in (ASVS V10.5.1): the client asks
 * for one, passes it to the provider and sends it back with the ID token. A token whose nonce the
 * API did not issue, or already accepted, is refused, so a stolen ID token cannot be replayed.
 * Only a hash of the nonce is stored.
 */
@Injectable()
export class SocialNonces {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async issue(): Promise<{ nonce: string; expiresAt: Date }> {
    const nonce = randomToken(32);
    await this.redis.set(nonceKey(nonce), '1', 'EX', SOCIAL_NONCE_TTL_SECONDS);
    return { nonce, expiresAt: new Date(Date.now() + SOCIAL_NONCE_TTL_SECONDS * 1000) };
  }

  /** True exactly once per issued, unexpired nonce, even under concurrent sign-ins. */
  async consume(nonce: string): Promise<boolean> {
    return (await this.redis.del(nonceKey(nonce))) === 1;
  }
}

export interface VerifiedSocialIdentity {
  provider: SocialProviderName;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/**
 * Verifies Google and Apple ID tokens: signature (provider JWKS), issuer, audience, expiry, and a
 * nonce this API issued and has not seen before.
 */
@Injectable()
export class SocialIdentityVerifier {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SOCIAL_KEY_RESOLVERS) private readonly resolvers: SocialKeyResolvers,
    private readonly nonces: SocialNonces,
  ) {}

  private audiences(provider: SocialProviderName): string[] {
    return provider === 'google' ? this.config.GOOGLE_CLIENT_IDS : this.config.APPLE_CLIENT_IDS;
  }

  async verify(
    provider: SocialProviderName,
    idToken: string,
    nonce: string,
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
    // Google echoes the raw nonce; Apple native flows carry its SHA-256 hex digest.
    const hashed = createHash('sha256').update(nonce).digest('hex');
    const actual = claims.data.nonce ?? '';
    if (!safeEqual(actual, nonce) && !safeEqual(actual, hashed)) throw invalidToken();
    // Consumed last: a token that fails any check above leaves the nonce for a retry.
    if (!(await this.nonces.consume(nonce))) throw invalidToken();
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
