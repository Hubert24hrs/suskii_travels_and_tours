import { pino, type Logger } from 'pino';

import { type WorkerConfig } from './config.js';

// Never log credentials, tokens or traveller PII. Centralised in phase 2.
const REDACT_PATHS = [
  '*.authorization',
  '*.cookie',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.passportNumber',
  '*.cardNumber',
];

export function createLogger(config: Pick<WorkerConfig, 'LOG_LEVEL'>): Logger {
  return pino({
    name: 'suskii-worker',
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  });
}

export type { Logger };
