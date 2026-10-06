import type { ExecutionContext } from '@nestjs/common';

import type { AppConfig } from '../config/config';

import { AppVersionGuard, compareVersions } from './app-version.guard';
import { ProblemDetailsException } from './problem-details';

const http = (client?: string): ExecutionContext =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ headers: client ? { 'x-suskii-client': client } : {} }),
    }),
  }) as unknown as ExecutionContext;

const guard = (min?: string) =>
  new AppVersionGuard({ MOBILE_MIN_VERSION: min } as unknown as AppConfig);

describe('AppVersionGuard (MASVS-CODE-2)', () => {
  it('compares versions numerically', () => {
    expect(compareVersions([1, 10, 0], [1, 9, 9])).toBeGreaterThan(0);
    expect(compareVersions([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(compareVersions([0, 9, 12], [1, 0, 0])).toBeLessThan(0);
  });

  it('refuses app versions older than the minimum with 426 and the minimum', () => {
    let refused: unknown;
    try {
      guard('1.4.0').canActivate(http('mobile-ios/1.3.9'));
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(ProblemDetailsException);
    expect((refused as ProblemDetailsException).getStatus()).toBe(426);
    expect((refused as ProblemDetailsException).slug).toBe('app-update-required');
    expect((refused as ProblemDetailsException).extensions).toEqual({ minVersion: '1.4.0' });
  });

  it('serves current apps, browsers and everything when no minimum is set', () => {
    expect(guard('1.4.0').canActivate(http('mobile-android/1.4.0'))).toBe(true);
    expect(guard('1.4.0').canActivate(http('mobile-android/2.0.1'))).toBe(true);
    expect(guard('1.4.0').canActivate(http('web/1.0.0'))).toBe(true);
    expect(guard('1.4.0').canActivate(http())).toBe(true);
    expect(guard().canActivate(http('mobile-ios/0.0.1'))).toBe(true);
  });
});
