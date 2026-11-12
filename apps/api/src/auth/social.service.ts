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
import {
  isMockSocialToken,
  MOCK_SOCIAL_AUDIENCE,
  mockIssuer,
  MockSocialIssuer,
} from './mock-social';

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

const UNBOUND = '1';

/**
 * Server-issued, single-use nonces for Google and Apple sign-in (ASVS V10.5.1): the client asks
 * for one, passes it to the provider and sends it back with the ID token. A token whose nonce the
 * API did not issue, or already accepted, is refused, so a stolen ID token cannot be replayed.
 * Only a hash of the nonce is stored.
 *
 * The app's sign-in through the website (ADR-067) also binds the nonce to a secret only the app
 * holds (`binding` is its SHA-256 hex): an ID token caught on its way back to the app is useless
 * without that secret.
 */
@Injectable()
export class SocialNonces {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async issue(binding?: string): Promise<{ nonce: string; expiresAt: Date }> {
    const nonce = randomToken(32);
    await this.redis.set(nonceKey(nonce), binding ?? UNBOUND, 'EX', SOCIAL_NONCE_TTL_SECONDS);
    return { nonce, expiresAt: new Date(Date.now() + SOCIAL_NONCE_TTL_SECONDS * 1000) };
  }

  /**
   * True exactly once per issued, unexpired nonce, even under concurrent sign-ins; a bound nonce
   * also needs the secret behind its binding.
   */
  async consume(nonce: string, bindingSecret?: string): Promise<boolean> {
    const stored = await this.redis.getdel(nonceKey(nonce));
    if (stored === null) return false;
    if (stored === UNBOUND) return true;
    return bindingSecret !== undefined && safeEqual(sha256(bindingSecret), stored);
  }
}

export interface VerifiedSocialIdentity {
  provider: SocialProviderName;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** Which sign-in providers clients may offer, and whether they are the test stack's mock. */
export interface SocialProvidersStatus {
  google: boolean;
  apple: boolean;
  mock: boolean;
}

/**
 * Verifies Google and Apple ID tokens: signature (provider JWKS), issuer, audience, expiry, and a
 * nonce this API issued and has not seen before. On a test stack with SOCIAL_MOCK_ENABLED, tokens
 * from the mock issuer (ADR-067) pass the same checks against its key.
 */
@Injectable()
export class SocialIdentityVerifier {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SOCIAL_KEY_RESOLVERS) private readonly resolvers: SocialKeyResolvers,
    private readonly nonces: SocialNonces,
    private readonly mock: MockSocialIssuer,
  ) {}

  private audiences(provider: SocialProviderName): string[] {
    return provider === 'google' ? this.config.GOOGLE_CLIENT_IDS : this.config.APPLE_CLIENT_IDS;
  }

  status(): SocialProvidersStatus {
    const mock = this.mock.enabled;
    return {
      google: mock || this.audiences('google').length > 0,
      apple: mock || this.audiences('apple').length > 0,
      mock,
    };
  }

  async verify(
    provider: SocialProviderName,
    idToken: string,
    nonce: string,
    bindingSecret?: string,
  ): Promise<VerifiedSocialIdentity> {
    const mock = this.mock.enabled && isMockSocialToken(idToken);
    const audience = mock ? [MOCK_SOCIAL_AUDIENCE] : this.audiences(provider);
    if (audience.length === 0) {
      throw new ProblemDetailsException(
        HttpStatus.NOT_FOUND,
        'social-provider-disabled',
        'Sign-in provider not enabled',
      );
    }
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(
        idToken,
        mock ? this.mock.resolver() : this.resolvers[provider],
        {
          issuer: mock ? [mockIssuer(provider)] : PROVIDERS[provider].issuers,
          audience,
          algorithms: mock ? ['EdDSA'] : ['RS256', 'ES256'],
          clockTolerance: 30,
        },
      ));
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
    if (!(await this.nonces.consume(nonce, bindingSecret))) throw invalidToken();
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
