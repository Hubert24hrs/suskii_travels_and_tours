import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type CryptoKey,
  type JWK,
  type JWTHeaderParameters,
} from 'jose';
import { z } from 'zod';

import { ROLES } from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../../config/config';

const ALGORITHM = 'EdDSA';

export const accessClaimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  roles: z.array(z.enum(ROLES)),
  /** True when this session completed MFA. */
  mfa: z.boolean(),
  /** Authentication methods references (RFC 8176): pwd, otp, google, apple, mfa. */
  amr: z.array(z.string()),
});

export type AccessClaims = z.infer<typeof accessClaimsSchema>;

export type PublicJwk = JWK & { kty: string; kid: string; alg: typeof ALGORITHM; use: 'sig' };

/** Accepts a PEM, or the base64 of a PEM (single-line env vars and secret managers). */
export function decodePem(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed.replace(/\\n/g, '\n').trim();
  return Buffer.from(trimmed, 'base64').toString('utf8').trim();
}

/**
 * Signs and verifies access tokens: EdDSA (Ed25519) JWTs with a `kid` equal to the RFC 7638
 * thumbprint of the public key. Retired public keys stay valid for verification during rotation
 * and are published in the JWKS.
 */
@Injectable()
export class AccessTokenService implements OnModuleInit {
  private readonly logger = new Logger(AccessTokenService.name);
  private signingKey!: CryptoKey;
  private signingKid!: string;
  private readonly verificationKeys = new Map<string, CryptoKey>();
  private jwks: PublicJwk[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    let publicKey: CryptoKey;
    if (this.config.JWT_PRIVATE_KEY && this.config.JWT_PUBLIC_KEY) {
      this.signingKey = await importPKCS8(decodePem(this.config.JWT_PRIVATE_KEY), ALGORITHM);
      publicKey = await importSPKI(decodePem(this.config.JWT_PUBLIC_KEY), ALGORITHM, {
        extractable: true,
      });
    } else {
      // Production requires configured keys (env schema). Dev and tests sign with a per-process
      // key, so tokens stop working after a restart.
      this.logger.warn('JWT keys are not configured; using an ephemeral Ed25519 key pair');
      const pair = await generateKeyPair(ALGORITHM, { crv: 'Ed25519', extractable: true });
      this.signingKey = pair.privateKey;
      publicKey = pair.publicKey;
    }
    this.signingKid = await this.addVerificationKey(publicKey);

    const previous = this.config.JWT_PREVIOUS_PUBLIC_KEYS?.split('|').filter(Boolean) ?? [];
    for (const pem of previous) {
      await this.addVerificationKey(
        await importSPKI(decodePem(pem), ALGORITHM, { extractable: true }),
      );
    }
  }

  private async addVerificationKey(key: CryptoKey): Promise<string> {
    const jwk = await exportJWK(key);
    if (!jwk.kty) throw new Error('Exported JWK has no key type');
    const kid = await calculateJwkThumbprint(jwk);
    if (!this.verificationKeys.has(kid)) {
      this.verificationKeys.set(kid, key);
      this.jwks.push({ ...jwk, kty: jwk.kty, kid, alg: ALGORITHM, use: 'sig' });
    }
    return kid;
  }

  get ttlSeconds(): number {
    return this.config.ACCESS_TOKEN_TTL_SECONDS;
  }

  async sign(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((issuedAt + this.ttlSeconds) * 1000);
    const { sub, ...rest } = claims;
    const token = await new SignJWT(rest)
      .setProtectedHeader({ alg: ALGORITHM, kid: this.signingKid, typ: 'at+jwt' })
      .setSubject(sub)
      .setIssuer(this.config.JWT_ISSUER)
      .setAudience(this.config.JWT_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .setJti(crypto.randomUUID())
      .sign(this.signingKey);
    return { token, expiresAt };
  }

  /** Throws on a bad signature, unknown `kid`, wrong issuer/audience/type, or expiry. */
  async verify(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(
      token,
      (header: JWTHeaderParameters) => {
        const key = header.kid ? this.verificationKeys.get(header.kid) : undefined;
        if (!key) throw new Error('Unknown signing key');
        return key;
      },
      {
        algorithms: [ALGORITHM],
        issuer: this.config.JWT_ISSUER,
        audience: this.config.JWT_AUDIENCE,
        typ: 'at+jwt',
        clockTolerance: 5,
      },
    );
    return accessClaimsSchema.parse(payload);
  }

  getJwks(): { keys: PublicJwk[] } {
    return { keys: this.jwks };
  }
}
