import {
  type HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { ProblemDetailsException } from './problem-details';

const MOBILE_CLIENT = /^mobile-(?:ios|android)\/(\d+)\.(\d+)\.(\d+)/i;

/** Compares dotted versions numerically: negative when `a` is older than `b`. */
export function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

// Nest's HttpStatus enum has no 426 Upgrade Required (RFC 9110, section 15.5.22).
const UPGRADE_REQUIRED = 426 as HttpStatus;

export const appUpdateRequired = (minVersion: string): ProblemDetailsException =>
  new ProblemDetailsException(
    UPGRADE_REQUIRED,
    'app-update-required',
    'Update the app',
    'This version of the app is no longer supported. Update it from the store to continue.',
    { minVersion },
  );

/**
 * Retires old app versions (MASVS-CODE-2): with MOBILE_MIN_VERSION set, a request whose
 * `X-Suskii-Client` names an older app version is answered 426 `app-update-required` before
 * anything else runs, including authentication. Browsers and server clients are unaffected.
 */
@Injectable()
export class AppVersionGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const minimum = this.config.MOBILE_MIN_VERSION;
    if (!minimum || context.getType() !== 'http') return true;
    const header = context.switchToHttp().getRequest<Request>().headers['x-suskii-client'];
    const match = MOBILE_CLIENT.exec(Array.isArray(header) ? (header[0] ?? '') : (header ?? ''));
    if (!match) return true;
    if (compareVersions(match.slice(1, 4).map(Number), minimum.split('.').map(Number)) < 0) {
      throw appUpdateRequired(minimum);
    }
    return true;
  }
}
