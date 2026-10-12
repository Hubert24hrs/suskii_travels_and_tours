import { sensitiveLogPaths } from '@suskii/shared';
import { pino, type DestinationStream, type Logger } from 'pino';

import { type WorkerConfig } from './config.js';

// Never log credentials, tokens or personal data (docs/security/logging-inventory.md).
const REDACT_PATHS = sensitiveLogPaths();

export function createLogger(
  config: Pick<WorkerConfig, 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    name: 'suskii-worker',
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

export type { Logger };
