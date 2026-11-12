import { Injectable } from '@nestjs/common';

/** What the app sent in `X-Suskii-Attestation`, with the challenge already consumed. */
export interface AttestationEvidence {
  platform: 'ios' | 'android';
  /** Play Integrity token, App Attest attestation object, or App Attest assertion. */
  kind: 'integrity' | 'attestation' | 'assertion';
  challenge: string;
  token: string;
  /** App Attest key id (iOS only). */
  keyId: string | null;
}

/**
 * Verifies a device attestation (ADR-023). Play Integrity and App Attest verifiers are added
 * behind this interface once the owner's Google Cloud project and Apple team id exist.
 */
export abstract class DeviceAttestationVerifier {
  abstract readonly name: string;
  abstract verify(evidence: AttestationEvidence): Promise<boolean>;
}

/**
 * Development, tests and e2e builds: accepts exactly `mock:<challenge>`, so a token bound to
 * another challenge fails like a replay would. Production refuses it (env schema).
 */
@Injectable()
export class MockDeviceAttestationVerifier extends DeviceAttestationVerifier {
  readonly name = 'mock';

  verify(evidence: AttestationEvidence): Promise<boolean> {
    return Promise.resolve(evidence.token === `mock:${evidence.challenge}`);
  }
}

/** No verifier configured: every attestation fails, so mobile guest checkout fails closed. */
@Injectable()
export class NoDeviceAttestationVerifier extends DeviceAttestationVerifier {
  readonly name = 'none';

  verify(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
