import { preferences } from './cache';
import { parseOrigin, testServer } from './test-server';

describe('test server', () => {
  beforeEach(() => preferences.clearAll());

  it('takes a bare http or https origin and nothing else', () => {
    expect(parseOrigin(' http://192.168.1.20:4000/ ')).toBe('http://192.168.1.20:4000');
    expect(parseOrigin('HTTPS://Stack.Example.com')).toBe('https://stack.example.com');
    expect(parseOrigin('http://[fd00::1]:3000')).toBe('http://[fd00::1]:3000');
    for (const bad of [
      '192.168.1.20:4000',
      'ftp://192.168.1.20',
      'http://192.168.1.20:4000/v1',
      'http://user:pass@192.168.1.20',
      'http://192.168.1.20:4000?x=1',
      'http://192.168.1.20:70000',
      'javascript:alert(1)',
    ]) {
      expect(parseOrigin(bad)).toBeNull();
    }
  });

  it('saves both addresses, says which one is wrong, and forgets them on reset', () => {
    expect(testServer.read()).toBeNull();
    expect(testServer.save({ api: 'http://192.168.1.20:4000/v1', web: 'nope' })).toEqual({
      ok: false,
      invalid: ['api', 'web'],
    });
    expect(testServer.read()).toBeNull();
    expect(
      testServer.save({ api: 'http://192.168.1.20:4000', web: 'http://192.168.1.20:3000/' }),
    ).toEqual({ ok: true });
    expect(testServer.read()).toEqual({
      api: 'http://192.168.1.20:4000',
      web: 'http://192.168.1.20:3000',
    });
    testServer.clear();
    expect(testServer.read()).toBeNull();
  });

  it('ignores a stored value it cannot read', () => {
    preferences.set('test-server', '{"api":"http://evil.example/path","web":"x"}');
    expect(testServer.read()).toBeNull();
    preferences.set('test-server', 'not json');
    expect(testServer.read()).toBeNull();
  });
});
