import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

export interface IdentityCheckInput {
  nin: string;
  givenNames: string;
  surname: string;
  /** YYYY-MM-DD. */
  dateOfBirth: string;
}

export interface LicenceCheckInput {
  licenceNumber: string;
  surname: string;
  /** YYYY-MM-DD the licence expires. */
  expiresOn: string;
}

/**
 * - `verified`: the record exists and matches.
 * - `mismatch`: the record exists but the details differ.
 * - `not_found`: no such record.
 */
export type KycOutcome = 'verified' | 'mismatch' | 'not_found';

export interface KycResult {
  outcome: KycOutcome;
  /** The provider's reference for the check, kept for audits; never the number itself. */
  reference: string;
}

/** Thrown when the provider could not answer; the check stays pending and can be retried. */
export class KycUnavailableError extends Error {
  constructor(reason: string) {
    super(`KYC check failed: ${reason}`);
    this.name = 'KycUnavailableError';
  }
}

/** Driver identity checks (ADR-050): NIN and driver's licence. Real providers are an owner decision. */
export abstract class KycProvider {
  abstract readonly name: string;
  abstract verifyIdentity(input: IdentityCheckInput): Promise<KycResult>;
  abstract verifyLicence(input: LicenceCheckInput): Promise<KycResult>;
}

const reference = (value: string): string =>
  `mock-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;

/**
 * Development and test KYC (refused in production with rides on, unless ALLOW_MOCK_PROVIDERS).
 * Numbers starting `000` are not found and `999` mismatch, so every outcome can be exercised;
 * everything else verifies.
 */
@Injectable()
export class MockKycProvider extends KycProvider {
  readonly name = 'mock';

  verifyIdentity(input: IdentityCheckInput): Promise<KycResult> {
    return Promise.resolve({ outcome: outcome(input.nin), reference: reference(input.nin) });
  }

  verifyLicence(input: LicenceCheckInput): Promise<KycResult> {
    return Promise.resolve({
      outcome: outcome(input.licenceNumber),
      reference: reference(input.licenceNumber),
    });
  }
}

function outcome(number: string): KycOutcome {
  if (number.startsWith('000')) return 'not_found';
  if (number.startsWith('999')) return 'mismatch';
  return 'verified';
}
