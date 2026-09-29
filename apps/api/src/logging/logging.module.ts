import type { IncomingMessage, ServerResponse } from 'node:http';

import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { resolveRequestId } from '../common/request-id';
import { APP_CONFIG, type AppConfig } from '../config/config';

/** Never log credentials, tokens, OTPs or personal data. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.code',
  '*.otp',
  '*.secret',
  '*.idToken',
  '*.mfaToken',
  '*.recoveryCode',
  '*.csrfToken',
  '*.email',
  '*.phone',
  '*.passportNumber',
];

const pathOnly = (url: string | undefined): string | undefined => url?.split('?')[0];

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.LOG_LEVEL,
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const id = resolveRequestId(req.headers['x-request-id']);
            res.setHeader('X-Request-Id', id);
            return id;
          },
          redact: { paths: REDACT_PATHS, censor: '[redacted]' },
          autoLogging: {
            ignore: (req: IncomingMessage) =>
              ['/health', '/ready'].includes(pathOnly(req.url) ?? ''),
          },
          serializers: {
            req: (req: { id: unknown; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: pathOnly(req.url),
            }),
            // Status only: response headers include Set-Cookie.
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          ...(config.NODE_ENV === 'development'
            ? {
                transport: { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
              }
            : {}),
        },
      }),
    }),
  ],
})
export class LoggingModule {}
