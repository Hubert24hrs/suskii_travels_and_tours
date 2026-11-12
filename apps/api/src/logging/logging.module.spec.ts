import { pino } from 'pino';

import { REDACT_PATHS } from './logging.module';

function logLine(object: Record<string, unknown>): string {
  const lines: string[] = [];
  const logger = pino(
    { redact: { paths: REDACT_PATHS, censor: '[redacted]' } },
    { write: (line: string) => lines.push(line) },
  );
  logger.info(object, 'test');
  return lines[0] ?? '';
}

describe('log redaction', () => {
  it('removes credentials from request and response headers', () => {
    const line = logLine({
      req: { headers: { authorization: 'Bearer secret-1', cookie: 'sid=secret-2' } },
      res: { headers: { 'set-cookie': 'sid=secret-3' } },
    });
    expect(line).not.toMatch(/secret-\d/);
  });

  it('removes personal data and codes from log objects at the top level and below', () => {
    const line = logLine({
      email: 'top@example.com',
      user: { id: 'u-1', phone: '+2348000000000' },
      body: { contact: { email: 'nested@example.com' }, otp: '123456' },
      job: { data: { passenger: { passportNumber: 'A1234567' } } },
    });
    expect(line).toContain('u-1');
    for (const value of [
      'top@example.com',
      '+2348000000000',
      'nested@example.com',
      '123456',
      'A1234567',
    ]) {
      expect(line).not.toContain(value);
    }
  });
});
