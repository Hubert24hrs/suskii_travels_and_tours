import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { decodeJwt, SignJWT, type JWTVerifyGetKey } from 'jose';

import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { HmacService } from '../crypto/hmac.service';
import { sha256 } from '../crypto/random';

import type { SocialProviderName } from './social.service';

/** Issuer of the test stacks' mock ID tokens: a reserved name that resolves nowhere. */
export const MOCK_SOCIAL_ISSUER = 'https://mock-social.suskii.invalid';
export const MOCK_SOCIAL_AUDIENCE = 'suskii-mock-social';
const TOKEN_LIFETIME = '10m';
/** PKCS #8 prefix of a raw Ed25519 private key (RFC 8410). */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export const mockIssuer = (provider: SocialProviderName): string =>
  `${MOCK_SOCIAL_ISSUER}/${provider}`;

/** True when `idToken` claims to come from the mock issuer (read without verifying it). */
export function isMockSocialToken(idToken: string): boolean {
  try {
    return decodeJwt(idToken).iss?.startsWith(`${MOCK_SOCIAL_ISSUER}/`) ?? false;
  } catch {
    return false;
  }
}

/**
 * The test stacks' stand-in for Google and Apple (ADR-067): it signs ID tokens for the email the
 * tester types, with a subject fixed by provider and email, so signing in again with the same
 * "account" reaches the same user. Tokens go through the same verifier as real ones (signature,
 * issuer, audience, expiry, single-use nonce). The key derives from HMAC_SECRET, so every API
 * replica verifies what another signed. Only when SOCIAL_MOCK_ENABLED, which production refuses.
 */
@Injectable()
export class MockSocialIssuer {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    hmac: HmacService,
  ) {
    const seed = Buffer.from(hmac.digest('social-mock-key', 'ed25519-seed-v1'), 'base64url');
    this.privateKey = createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
      format: 'der',
      type: 'pkcs8',
    });
    this.publicKey = createPublicKey(this.privateKey);
  }

  get enabled(): boolean {
    return this.config.SOCIAL_MOCK_ENABLED && this.config.NODE_ENV !== 'production';
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new ProblemDetailsException(
        HttpStatus.NOT_FOUND,
        'social-provider-disabled',
        'Sign-in provider not enabled',
      );
    }
  }

  /** The subject a provider would give this email: stable, and no email in it. */
  static subjectFor(provider: SocialProviderName, email: string): string {
    return `mock-${sha256(`${provider}:${email.toLowerCase()}`).slice(0, 32)}`;
  }

  async issue(input: {
    provider: SocialProviderName;
    email: string;
    name?: string | undefined;
    nonce: string;
  }): Promise<string> {
    this.assertEnabled();
    const email = input.email.toLowerCase();
    return new SignJWT({
      email,
      email_verified: true,
      nonce: input.nonce,
      ...(input.name ? { name: input.name } : {}),
    })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
      .setIssuer(mockIssuer(input.provider))
      .setAudience(MOCK_SOCIAL_AUDIENCE)
      .setSubject(MockSocialIssuer.subjectFor(input.provider, email))
      .setIssuedAt()
      .setExpirationTime(TOKEN_LIFETIME)
      .sign(this.privateKey);
  }

  /** The verifying key, for the verifier; refuses while the mock is off. */
  resolver(): JWTVerifyGetKey {
    this.assertEnabled();
    return () => Promise.resolve(this.publicKey);
  }
}
