import { sensitiveLogPaths } from '@suskii/shared';
import { pino, type DestinationStream, type Logger } from 'pino';

import { type AgentConfig } from './config.js';

// Never log credentials, grants or what was said (docs/security/logging-inventory.md).
const REDACT_PATHS = [...sensitiveLogPaths(), 'grant', '*.grant', 'text', '*.text'];

export function createLogger(
  config: Pick<AgentConfig, 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    name: 'suskii-agent',
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

export type { Logger };
