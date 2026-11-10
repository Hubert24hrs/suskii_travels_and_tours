import { assertFetchable, FetchRefused, isPrivateAddress, resolvePublic } from './ssrf-guard';

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof FetchRefused) return error.code;
    throw error;
  }
  return 'allowed';
};

describe('SSRF guard for addresses Suskii fetches itself (ADR-102)', () => {
  it('knows the addresses that are never a public website', () => {
    for (const address of [
      '127.0.0.1',
      '127.8.9.1',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.10',
      '169.254.169.254', // cloud metadata
      '100.64.0.1',
      '0.0.0.0',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456:789a::1',
      'fe80::1',
      'fe80::1%eth0',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '64:ff9b::7f00:1',
      'not-an-address',
      '',
    ]) {
      expect([address, isPrivateAddress(address)]).toEqual([address, true]);
    }
    for (const address of [
      '8.8.8.8',
      '1.1.1.1',
      '172.15.0.1',
      '172.32.0.1',
      '192.167.1.1',
      '100.63.255.255',
      '2606:4700:4700::1111',
      '2a00:1450:4009:80b::200e',
      '::ffff:8.8.8.8',
    ]) {
      expect([address, isPrivateAddress(address)]).toEqual([address, false]);
    }
  });

  it('accepts only https addresses on the policy domain, by name, on the default port', () => {
    const check = (address: string): string =>
      refusal(() => assertFetchable(address, 'example.com'));
    expect(check('https://example.com/rooms?city=lagos')).toBe('allowed');
    expect(check('https://rooms.example.com:443/x')).toBe('allowed');
    expect(check('http://example.com/')).toBe('not_https');
    expect(check('ftp://example.com/')).toBe('not_https');
    expect(check('file:///etc/passwd')).toBe('not_https');
    expect(check('not a url')).toBe('not_https');
    expect(check('https://user:pw@example.com/')).toBe('credentials');
    expect(check('https://example.com:8443/')).toBe('port');
    expect(check('https://127.0.0.1/')).toBe('ip_literal');
    expect(check('https://[::1]/')).toBe('ip_literal');
    expect(check('https://169.254.169.254/latest/meta-data/')).toBe('ip_literal');
    expect(check('https://example.com.evil.net/')).toBe('host_outside_policy');
    expect(check('https://evil.net/?u=example.com')).toBe('host_outside_policy');
    expect(check('https://notexample.com/')).toBe('host_outside_policy');
    // Decimal and hexadecimal spellings of an IP address are still IP addresses.
    expect(check('https://2130706433/')).not.toBe('allowed');
    expect(check('https://0x7f000001/')).not.toBe('allowed');
  });

  it('refuses a name that resolves to a private address, even beside a public one', async () => {
    const answers =
      (...addresses: string[]) =>
      () =>
        Promise.resolve(
          addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
        );
    await expect(resolvePublic('example.com', answers('93.184.216.34'))).resolves.toHaveLength(1);
    await expect(resolvePublic('example.com', answers('10.0.0.5'))).rejects.toMatchObject({
      code: 'private_address',
    });
    await expect(
      resolvePublic('example.com', answers('93.184.216.34', '127.0.0.1')),
    ).rejects.toMatchObject({ code: 'private_address' });
    await expect(
      resolvePublic('example.com', answers('2606:4700::1', '::ffff:169.254.169.254')),
    ).rejects.toMatchObject({ code: 'private_address' });
    await expect(resolvePublic('example.com', answers())).rejects.toMatchObject({
      code: 'unresolvable',
    });
    await expect(
      resolvePublic('example.com', () => Promise.reject(new Error('ENOTFOUND'))),
    ).rejects.toMatchObject({ code: 'unresolvable' });
  });
});
