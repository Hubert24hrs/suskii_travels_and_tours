import { createHmac, randomBytes } from 'node:crypto';

/** RFC 6238 TOTP (HMAC-SHA1, 30-second steps, 6 digits): what every authenticator app supports. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160-bit secret, as recommended by RFC 4226 section 4. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function timeStep(nowMs: number, period = TOTP_PERIOD_SECONDS): number {
  return Math.floor(nowMs / 1000 / period);
}

/** HOTP (RFC 4226) value for a counter; TOTP uses the time step as the counter. */
export function hotp(
  secret: Buffer,
  counter: number,
  digits = TOTP_DIGITS,
  algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1',
): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export interface TotpVerification {
  /** The matched time step; store it to reject replays of the same code. */
  step: number;
}

/**
 * Accepts the current step plus or minus `window` steps for clock drift. Codes for steps at or
 * before `lastUsedStep` are rejected (RFC 6238 section 5.2: one-time use).
 */
export function verifyTotp(
  base32Secret: string,
  code: string,
  options: { nowMs?: number; window?: number; lastUsedStep?: number | null } = {},
): TotpVerification | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(base32Secret);
  const current = timeStep(options.nowMs ?? Date.now());
  const window = options.window ?? 1;
  for (let drift = -window; drift <= window; drift += 1) {
    const step = current + drift;
    const last = options.lastUsedStep;
    if (last !== undefined && last !== null && step <= last) continue;
    if (hotp(secret, step) === code) return { step };
  }
  return null;
}

/** `otpauth://` URI rendered as a QR code by the client (Key Uri Format). */
export function otpauthUri(params: { secret: string; issuer: string; account: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.account}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
