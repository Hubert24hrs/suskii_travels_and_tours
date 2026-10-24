/**
 * Field names whose values never reach a log line (credentials, tokens, one-time codes and
 * personal data). The API and the worker redact them in log objects; see
 * docs/security/logging-inventory.md.
 */
export const SENSITIVE_LOG_FIELDS = [
  'authorization',
  'cookie',
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'mfaToken',
  'csrfToken',
  'code',
  'otp',
  'recoveryCode',
  'secret',
  'email',
  'phone',
  'passportNumber',
  'cardNumber',
  // Cars (ADR-050): ride PINs, trip share tokens, ticket QR payloads and identity numbers.
  'pin',
  'shareToken',
  'qrPayload',
  'nin',
  'licenceNumber',
] as const;

/** How many levels below the log object's own keys the fields are still redacted. */
export const LOG_REDACTION_DEPTH = 3;

/**
 * Pino redaction paths for the sensitive fields. A pino wildcard matches exactly one level, so
 * each field gets a path per depth: `email`, `*.email`, `*.*.email` and `*.*.*.email`.
 */
export function sensitiveLogPaths(): string[] {
  const prefixes = Array.from({ length: LOG_REDACTION_DEPTH + 1 }, (_, depth) =>
    '*.'.repeat(depth),
  );
  return prefixes.flatMap((prefix) => SENSITIVE_LOG_FIELDS.map((field) => `${prefix}${field}`));
}
