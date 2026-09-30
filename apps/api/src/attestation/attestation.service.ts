import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { REDIS } from '../infra/redis';

import { DeviceAttestationVerifier, type AttestationEvidence } from './device-attestation-verifier';

export const ATTESTATION_HEADER_NAME = 'x-suskii-attestation';
export const CHALLENGE_TTL_SECONDS = 300;
const MAX_HEADER_LENGTH = 16_384;

export type AttestationOutcome = 'valid' | 'missing' | 'invalid';

const headerSchema = z.object({
  v: z.literal(1),
  platform: z.enum(['ios', 'android']),
  kind: z.enum(['integrity', 'attestation', 'assertion']),
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  token: z.string().min(1).max(12_000),
  keyId: z.string().min(1).max(256).nullable().default(null),
});

const challengeKey = (challenge: string): string =>
  `attest:challenge:${createHash('sha256').update(challenge).digest('hex')}`;

/** Parses the base64url JSON header; null for anything malformed. */
export function parseAttestationHeader(value: string | undefined): AttestationEvidence | null {
  if (!value || value.length > MAX_HEADER_LENGTH) return null;
  try {
    const json: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const parsed = headerSchema.safeParse(json);
    if (!parsed.success) return null;
    const { platform, kind, challenge, token, keyId } = parsed.data;
    return { platform, kind, challenge, token, keyId };
  } catch {
    return null;
  }
}

/**
 * Single-use challenges and verification of `X-Suskii-Attestation` (ADR-023). The challenge is
 * consumed before the verifier runs, so a token can be presented only once.
 */
@Injectable()
export class AttestationService {
  private readonly logger = new Logger(AttestationService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly verifier: DeviceAttestationVerifier,
  ) {}

  async issueChallenge(now = new Date()): Promise<{ challenge: string; expiresAt: string }> {
    const challenge = randomBytes(32).toString('base64url');
    await this.redis.set(challengeKey(challenge), '1', 'EX', CHALLENGE_TTL_SECONDS);
    return {
      challenge,
      expiresAt: new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async verify(header: string | undefined, action: string): Promise<AttestationOutcome> {
    if (!header) return 'missing';
    const evidence = parseAttestationHeader(header);
    if (!evidence) return this.fail(action, 'malformed');
    const consumed = await this.redis.getdel(challengeKey(evidence.challenge));
    if (!consumed) return this.fail(action, 'unknown_challenge');
    try {
      return (await this.verifier.verify(evidence)) ? 'valid' : this.fail(action, 'rejected');
    } catch (error) {
      this.logger.warn({ action, reason: (error as Error).name }, 'attestation verifier failed');
      return 'invalid';
    }
  }

  private fail(action: string, reason: string): AttestationOutcome {
    this.logger.warn({ action, reason, verifier: this.verifier.name }, 'attestation failed');
    return 'invalid';
  }
}
