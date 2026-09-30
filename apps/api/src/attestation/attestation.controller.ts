import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { z } from 'zod';

import { Public } from '../auth/decorators';
import { Contract } from '../contract/contract';
import { DEVICE_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import { attestationChallengeSchema } from './attestation.schemas';
import { AttestationService } from './attestation.service';

@Public()
@Controller('attestation')
export class AttestationController {
  constructor(private readonly attestation: AttestationService) {}

  @Post('challenges')
  @RateLimit(DEVICE_LIMITS.challengeIp)
  @HttpCode(HttpStatus.CREATED)
  @Contract({
    operationId: 'createAttestationChallenge',
    summary: 'A single-use challenge for a device attestation',
    description:
      'The app binds its Play Integrity or App Attest token to this challenge and sends both in `X-Suskii-Attestation` within five minutes (ADR-023).',
    tags: ['Mobile'],
    responses: { 201: attestationChallengeSchema },
  })
  create(): Promise<z.infer<typeof attestationChallengeSchema>> {
    return this.attestation.issueChallenge();
  }
}
