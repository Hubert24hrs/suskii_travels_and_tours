import { generateKeyPairSync } from 'node:crypto';

import type { AppConfig } from '../../config/config';
import { HmacService } from '../../crypto/hmac.service';
import { CsrfService } from '../csrf.service';

import { AccessTokenService, decodePem, type AccessClaims } from './access-token.service';

const pemPair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
};

const baseConfig = {
  JWT_ISSUER: 'suskii-api',
  JWT_AUDIENCE: 'suskii',
  ACCESS_TOKEN_TTL_SECONDS: 900,
} as AppConfig;

const claims: AccessClaims = {
  sub: '0192f0e0-0000-7000-8000-000000000001',
  sid: '0192f0e0-0000-7000-8000-000000000002',
  roles: ['customer'],
  mfa: false,
  amr: ['pwd'],
};

async function service(config: Partial<AppConfig>): Promise<AccessTokenService> {
  const instance = new AccessTokenService({ ...baseConfig, ...config });
  await instance.onModuleInit();
  return instance;
}

describe('AccessTokenService', () => {
  it('accepts PEM and base64-encoded PEM keys', () => {
    const { publicKey } = pemPair();
    expect(decodePem(Buffer.from(publicKey).toString('base64'))).toBe(publicKey.trim());
    expect(decodePem(publicKey.replace(/\n/g, '\\n'))).toBe(publicKey.trim());
  });

  it('signs 15-minute EdDSA tokens and verifies them', async () => {
    const keys = pemPair();
    const tokens = await service({
      JWT_PRIVATE_KEY: keys.privateKey,
      JWT_PUBLIC_KEY: keys.publicKey,
    });
    const { token, expiresAt } = await tokens.sign(claims);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(890_000);
    await expect(tokens.verify(token)).resolves.toEqual(claims);
    expect(tokens.getJwks().keys).toHaveLength(1);
  });

  it('keeps accepting tokens signed by a retired key during rotation, and nothing else', async () => {
    const oldKeys = pemPair();
    const newKeys = pemPair();
    const before = await service({
      JWT_PRIVATE_KEY: oldKeys.privateKey,
      JWT_PUBLIC_KEY: oldKeys.publicKey,
    });
    const legacyToken = (await before.sign(claims)).token;

    const rotated = await service({
      JWT_PRIVATE_KEY: newKeys.privateKey,
      JWT_PUBLIC_KEY: newKeys.publicKey,
      JWT_PREVIOUS_PUBLIC_KEYS: Buffer.from(oldKeys.publicKey).toString('base64'),
    });
    await expect(rotated.verify(legacyToken)).resolves.toEqual(claims);
    expect(rotated.getJwks().keys.map((key) => key.kid)).toHaveLength(2);

    const unrelated = await service({});
    await expect(unrelated.verify(legacyToken)).rejects.toThrow();
  });

  it('rejects tokens for another audience or issuer', async () => {
    const keys = pemPair();
    const issuer = await service({
      JWT_PRIVATE_KEY: keys.privateKey,
      JWT_PUBLIC_KEY: keys.publicKey,
      JWT_AUDIENCE: 'other',
    });
    const { token } = await issuer.sign(claims);
    const verifier = await service({
      JWT_PRIVATE_KEY: keys.privateKey,
      JWT_PUBLIC_KEY: keys.publicKey,
    });
    await expect(verifier.verify(token)).rejects.toThrow();
  });
});

describe('CsrfService', () => {
  const csrf = new CsrfService(new HmacService({ HMAC_SECRET: 'x'.repeat(32) } as AppConfig));

  it('binds tokens to one session', () => {
    const token = csrf.issue('session-a');
    expect(csrf.verify('session-a', token)).toBe(true);
    expect(csrf.verify('session-b', token)).toBe(false);
    expect(csrf.verify('session-a', undefined)).toBe(false);
    expect(csrf.verify('session-a', `${token}.extra`)).toBe(false);
    expect(
      csrf.verify(
        'session-a',
        token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
      ),
    ).toBe(false);
  });
});
