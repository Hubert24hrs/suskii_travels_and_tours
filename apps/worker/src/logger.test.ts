import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('redacts credentials and personal data at any depth', () => {
    const lines: string[] = [];
    const logger = createLogger({ LOG_LEVEL: 'info' }, { write: (line) => lines.push(line) });

    logger.info(
      {
        email: 'top@example.com',
        job: { id: 'job-1', email: 'traveller@example.com', token: 'abc' },
        request: { headers: { authorization: 'Bearer abc' } },
      },
      'job done',
    );

    const [line] = lines;
    expect(line).toContain('job-1');
    expect(line).not.toContain('top@example.com');
    expect(line).not.toContain('traveller@example.com');
    expect(line).not.toContain('Bearer abc');
    expect(line).not.toContain('"abc"');
    expect(line).toContain('[redacted]');
  });
});
