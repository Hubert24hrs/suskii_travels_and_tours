import { describe, expect, it } from 'vitest';

import { LOG_REDACTION_DEPTH, SENSITIVE_LOG_FIELDS, sensitiveLogPaths } from './log-redaction';

describe('sensitiveLogPaths', () => {
  it('names every sensitive field at each depth, because a pino wildcard matches one level', () => {
    const paths = sensitiveLogPaths();
    expect(paths).toHaveLength(SENSITIVE_LOG_FIELDS.length * (LOG_REDACTION_DEPTH + 1));
    for (const field of ['password', 'refreshToken', 'email', 'phone', 'passportNumber', 'otp']) {
      expect(paths).toEqual(
        expect.arrayContaining([field, `*.${field}`, `*.*.${field}`, `*.*.*.${field}`]),
      );
    }
  });
});
