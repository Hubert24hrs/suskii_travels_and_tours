import { parseAttestationHeader } from './attestation.service';
import {
  MockDeviceAttestationVerifier,
  NoDeviceAttestationVerifier,
  type DeviceAttestationVerifier,
} from './device-attestation-verifier';

const CHALLENGE = 'q'.repeat(43);
const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

describe('parseAttestationHeader', () => {
  it('reads a well-formed header', () => {
    expect(
      parseAttestationHeader(
        encode({ v: 1, platform: 'android', kind: 'integrity', challenge: CHALLENGE, token: 't' }),
      ),
    ).toEqual({
      platform: 'android',
      kind: 'integrity',
      challenge: CHALLENGE,
      token: 't',
      keyId: null,
    });
  });

  it('rejects anything malformed', () => {
    const valid = { v: 1, platform: 'ios', kind: 'assertion', challenge: CHALLENGE, token: 't' };
    for (const header of [
      undefined,
      '',
      'not base64 json',
      encode({ ...valid, v: 2 }),
      encode({ ...valid, platform: 'web' }),
      encode({ ...valid, challenge: 'short' }),
      encode({ ...valid, token: '' }),
      'x'.repeat(20_000),
    ]) {
      expect(parseAttestationHeader(header)).toBeNull();
    }
  });
});

describe('attestation verifiers', () => {
  const evidence = {
    platform: 'android' as const,
    kind: 'integrity' as const,
    challenge: CHALLENGE,
    keyId: null,
  };

  it('the mock accepts only a token bound to the challenge', async () => {
    const mock = new MockDeviceAttestationVerifier();
    await expect(mock.verify({ ...evidence, token: `mock:${CHALLENGE}` })).resolves.toBe(true);
    await expect(mock.verify({ ...evidence, token: `mock:${'r'.repeat(43)}` })).resolves.toBe(
      false,
    );
    await expect(mock.verify({ ...evidence, token: 'anything' })).resolves.toBe(false);
  });

  it('without a verifier every attestation fails', async () => {
    const none: DeviceAttestationVerifier = new NoDeviceAttestationVerifier();
    await expect(none.verify({ ...evidence, token: `mock:${CHALLENGE}` })).resolves.toBe(false);
  });
});
