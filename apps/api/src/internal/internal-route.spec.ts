import { NotFoundException, type ExecutionContext } from '@nestjs/common';

import { ProblemDetailsException } from '../common/problem-details';
import type { AppConfig } from '../config/config';

import { InternalTokenGuard } from './internal-route';

const TOKEN = 'a'.repeat(24) + 'b'.repeat(24);

const contextWith = (authorization?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  }) as unknown as ExecutionContext;

const guard = (token?: string) =>
  new InternalTokenGuard({ INTERNAL_API_TOKEN: token } as unknown as AppConfig);

describe('InternalTokenGuard', () => {
  it('accepts the configured service token', () => {
    expect(guard(TOKEN).canActivate(contextWith(`Bearer ${TOKEN}`))).toBe(true);
  });

  it('rejects missing, malformed and wrong tokens with 401', () => {
    for (const header of [
      undefined,
      TOKEN,
      `Bearer ${TOKEN.slice(1)}`,
      `Bearer ${TOKEN}x`,
      'Basic abc',
    ]) {
      expect(() => guard(TOKEN).canActivate(contextWith(header))).toThrow(ProblemDetailsException);
    }
  });

  it('hides the routes entirely when no token is configured', () => {
    expect(() => guard(undefined).canActivate(contextWith(`Bearer ${TOKEN}`))).toThrow(
      NotFoundException,
    );
  });
});
