import { createHash } from 'node:crypto';

import type { AppConfig } from '../config/config';

import { HibpBreachedPasswordChecker } from './breached-password';
import { LocalKeyFieldEncryption } from './field-encryption';
import { HmacService } from './hmac.service';
import { PasswordHasher } from './password-hasher';
import { randomDigits, safeEqual } from './random';

const config = {
  HMAC_SECRET: 'a'.repeat(32),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
} as AppConfig;

describe('HmacService', () => {
  const hmac = new HmacService(config);

  it('derives independent keys per purpose', () => {
    expect(hmac.digest('ip', '203.0.113.9')).toBe(hmac.digest('ip', '203.0.113.9'));
    expect(hmac.digest('ip', '203.0.113.9')).not.toBe(hmac.digest('otp', '203.0.113.9'));
    expect(hmac.verify('otp', '123456', hmac.digest('otp', '123456'))).toBe(true);
    expect(hmac.verify('otp', '123457', hmac.digest('otp', '123456'))).toBe(false);
  });

  it('changes every digest when the secret changes', () => {
    const other = new HmacService({ ...config, HMAC_SECRET: 'b'.repeat(32) });
    expect(other.digest('ip', 'x')).not.toBe(hmac.digest('ip', 'x'));
  });
});

describe('LocalKeyFieldEncryption', () => {
  const cipher = new LocalKeyFieldEncryption(config);

  it('round-trips and never repeats a ciphertext', () => {
    const a = cipher.encrypt('JBSWY3DPEHPK3PXP', 'mfa:user-1');
    const b = cipher.encrypt('JBSWY3DPEHPK3PXP', 'mfa:user-1');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(cipher.decrypt(a, 'mfa:user-1')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rejects tampering and ciphertexts moved to another record', () => {
    const envelope = cipher.encrypt('secret', 'mfa:user-1');
    expect(() => cipher.decrypt(envelope, 'mfa:user-2')).toThrow();
    const [version, iv, data, tag] = envelope.split('.');
    const flipped = Buffer.from(data ?? '', 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() =>
      cipher.decrypt([version, iv, flipped.toString('base64url'), tag].join('.'), 'mfa:user-1'),
    ).toThrow();
    expect(() => cipher.decrypt('v9.a.b.c', 'mfa:user-1')).toThrow(/Unsupported/);
  });
});

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('hashes with argon2id at the OWASP parameters and verifies', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(hasher.verify(hash, 'correct horse battery')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'wrong horse battery')).resolves.toBe(false);
    await expect(hasher.verify('not-a-hash', 'x')).resolves.toBe(false);
    expect(hasher.needsRehash(hash)).toBe(false);
    expect(hasher.needsRehash('$argon2id$v=19$m=4096,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo')).toBe(
      true,
    );
  });

  it('spends verification time for unknown accounts', async () => {
    await expect(hasher.verifyDummy('whatever')).resolves.toBe(false);
  });
});

describe('HibpBreachedPasswordChecker', () => {
  const digest = createHash('sha1').update('password123').digest('hex').toUpperCase();

  it('sends only the 5-character prefix and matches the suffix', async () => {
    const fetchMock = jest.fn((url: string, init?: RequestInit): Promise<Response> => {
      expect(url).toBe(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`);
      expect(new Headers(init?.headers).get('Add-Padding')).toBe('true');
      return Promise.resolve(
        new Response(`0000000000000000000000000000000000A:0\r\n${digest.slice(5)}:42\r\n`),
      );
    });
    const checker = new HibpBreachedPasswordChecker(fetchMock as unknown as typeof fetch);
    await expect(checker.isBreached('password123')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores padding entries with a zero count and fails open on errors', async () => {
    const padded = new HibpBreachedPasswordChecker(() =>
      Promise.resolve(new Response(`${digest.slice(5)}:0\r\n`)),
    );
    await expect(padded.isBreached('password123')).resolves.toBe(false);
    const down = new HibpBreachedPasswordChecker(() => Promise.reject(new Error('offline')));
    await expect(down.isBreached('password123')).resolves.toBe(false);
  });
});

describe('random helpers', () => {
  it('produces fixed-length digit codes and compares in constant time', () => {
    expect(randomDigits(6)).toMatch(/^\d{6}$/);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
