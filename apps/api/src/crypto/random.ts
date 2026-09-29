import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** URL-safe random token with `bytes` of entropy (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Uniformly random numeric code, e.g. a 6-digit OTP (no modulo bias). */
export function randomDigits(length: number): string {
  let code = '';
  for (let index = 0; index < length; index += 1) code += String(randomInt(10));
  return code;
}

/** SHA-256 hex digest. Only for high-entropy secrets (random tokens), never passwords or OTPs. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time string comparison that also hides length differences. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right) && a.length === b.length;
}
