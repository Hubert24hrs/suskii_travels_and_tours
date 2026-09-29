import { base32Decode, base32Encode, hotp, otpauthUri, timeStep, verifyTotp } from './totp';

describe('HOTP (RFC 4226 appendix D)', () => {
  it('matches every published test vector', () => {
    const secret = Buffer.from('12345678901234567890');
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expected.forEach((code, counter) => expect(hotp(secret, counter)).toBe(code));
  });
});

describe('TOTP (RFC 6238 appendix B)', () => {
  const sha1 = Buffer.from('12345678901234567890');
  const sha256 = Buffer.from('12345678901234567890123456789012');
  const sha512 = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234');
  const vectors: [number, string, string, string][] = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];

  it.each(vectors)('at %i seconds', (seconds, codeSha1, codeSha256, codeSha512) => {
    const step = timeStep(seconds * 1000);
    expect(hotp(sha1, step, 8, 'sha1')).toBe(codeSha1);
    expect(hotp(sha256, step, 8, 'sha256')).toBe(codeSha256);
    expect(hotp(sha512, step, 8, 'sha512')).toBe(codeSha512);
  });
});

describe('verifyTotp', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  const nowMs = 1_700_000_000_000;
  const codeAt = (offsetSteps: number): string =>
    hotp(base32Decode(secret), timeStep(nowMs) + offsetSteps);

  it('accepts the current step and one step of drift either way', () => {
    expect(verifyTotp(secret, codeAt(0), { nowMs })).toEqual({ step: timeStep(nowMs) });
    expect(verifyTotp(secret, codeAt(-1), { nowMs })).not.toBeNull();
    expect(verifyTotp(secret, codeAt(1), { nowMs })).not.toBeNull();
    expect(verifyTotp(secret, codeAt(2), { nowMs })).toBeNull();
  });

  it('rejects replays of a code at or before the last used step', () => {
    const first = verifyTotp(secret, codeAt(0), { nowMs });
    expect(first).not.toBeNull();
    expect(verifyTotp(secret, codeAt(0), { nowMs, lastUsedStep: first?.step })).toBeNull();
    expect(verifyTotp(secret, codeAt(-1), { nowMs, lastUsedStep: first?.step })).toBeNull();
  });

  it('rejects malformed codes', () => {
    expect(verifyTotp(secret, '12345', { nowMs })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { nowMs })).toBeNull();
  });
});

describe('base32 and otpauth', () => {
  it('round-trips arbitrary bytes (RFC 4648 vectors)', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb oi======').toString()).toBe('foobar');
  });

  it('builds a Key Uri Format URI', () => {
    const uri = new URL(otpauthUri({ secret: 'ABC', issuer: 'Suskii Travels', account: 'a@b.co' }));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Suskii Travels:a@b.co');
    expect(uri.searchParams.get('secret')).toBe('ABC');
    expect(uri.searchParams.get('issuer')).toBe('Suskii Travels');
  });
});
