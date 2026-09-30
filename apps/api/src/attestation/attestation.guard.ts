import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { clientContext } from '../search/client-context';

import { ATTESTATION_HEADER_NAME, AttestationService } from './attestation.service';

export const DEVICE_ATTESTED = 'suskii:device-attested';

/**
 * Marks a sensitive route (login, registration, payment start). Requests that identify as the
 * mobile app are checked per `ATTESTATION_MODE` (ADR-023); the header is spoofable, so this
 * defends against modified apps, not scripts.
 */
export const DeviceAttested = (action: string): MethodDecorator =>
  SetMetadata(DEVICE_ATTESTED, action);

export const attestationRequired = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.FORBIDDEN,
    'attestation-required',
    'We could not verify this device',
    'Update the app from the official store and try again.',
  );

@Injectable()
export class AttestationGuard implements CanActivate {
  private readonly logger = new Logger(AttestationGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly attestation: AttestationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.config.ATTESTATION_MODE === 'off' || context.getType() !== 'http') return true;
    const action = this.reflector.get<string | undefined>(DEVICE_ATTESTED, context.getHandler());
    if (!action) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (clientContext(request).channel !== 'mobile') return true;
    const header = request.headers[ATTESTATION_HEADER_NAME];
    const outcome = await this.attestation.verify(
      Array.isArray(header) ? header[0] : header,
      action,
    );
    if (outcome === 'valid') return true;
    if (this.config.ATTESTATION_MODE === 'report') {
      this.logger.warn({ action, outcome }, 'attestation would have been refused (report mode)');
      return true;
    }
    throw attestationRequired();
  }
}
