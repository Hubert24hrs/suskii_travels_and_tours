import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies safe defaults for an empty environment', () => {
    expect(loadConfig({})).toStrictEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      WORKER_HEALTH_PORT: 4100,
    });
  });

  it('coerces the health port from a string', () => {
    expect(loadConfig({ WORKER_HEALTH_PORT: '9000' }).WORKER_HEALTH_PORT).toBe(9000);
  });

  it('rejects invalid values and names the offending key without echoing the value', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'shout', WORKER_HEALTH_PORT: '70000' })).toThrow(
      /LOG_LEVEL.*WORKER_HEALTH_PORT/,
    );
    expect(() => loadConfig({ LOG_LEVEL: 'super-secret-value' })).not.toThrow(/super-secret-value/);
  });
});
