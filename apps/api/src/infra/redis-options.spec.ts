import { redisTls } from './redis-options';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ==\n-----END CERTIFICATE-----';

describe('redisTls', () => {
  it('trusts the configured CA on a TLS connection, as a PEM or its base64', () => {
    expect(redisTls({ REDIS_URL: 'rediss://cache:6378', REDIS_TLS_CA: PEM })).toEqual({
      tls: { ca: PEM },
    });
    expect(
      redisTls({
        REDIS_URL: 'rediss://cache:6378',
        REDIS_TLS_CA: Buffer.from(PEM).toString('base64'),
      }),
    ).toEqual({ tls: { ca: PEM } });
  });

  it('changes nothing without a CA or without TLS', () => {
    expect(redisTls({ REDIS_URL: 'rediss://cache:6378', REDIS_TLS_CA: undefined })).toEqual({});
    expect(redisTls({ REDIS_URL: 'redis://cache:6379', REDIS_TLS_CA: PEM })).toEqual({});
  });
});
