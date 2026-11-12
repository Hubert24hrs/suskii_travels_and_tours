import { z } from 'zod';

import { named } from '../contract/contract';

export const ATTESTATION_HEADER = {
  name: 'X-Suskii-Attestation',
  required: false,
  description:
    'Mobile app: base64url JSON with the platform, a challenge from `POST /v1/attestation/challenges` and the Play Integrity or App Attest token bound to it (ADR-023). Each challenge works once.',
};

export const attestationChallengeSchema = named(
  'AttestationChallenge',
  z.object({
    challenge: z.string(),
    expiresAt: z.iso.datetime(),
  }),
);
