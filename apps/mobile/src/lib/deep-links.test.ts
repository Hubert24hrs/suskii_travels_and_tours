import { daysFromToday } from './dates';
import { queryInput, resolveIncomingUrl, resolveNotificationPath } from './deep-links';

const ID = '0192d3a0-7c1e-7b2a-9f00-1234567890ab';
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
const WEB = 'www.suskii.example';

describe('resolveIncomingUrl', () => {
  it('maps emailed booking links to the trip and keeps the access token out of the path', () => {
    expect(
      resolveIncomingUrl(`https://${WEB}/bookings/${ID.toUpperCase()}#access=${TOKEN}`, WEB),
    ).toEqual({
      path: `/trips/${ID}`,
      access: { bookingId: ID, token: TOKEN },
    });
    expect(resolveIncomingUrl(`https://${WEB}/bookings/${ID}`, WEB)).toEqual({
      path: `/trips/${ID}`,
    });
  });

  it('ignores malformed access fragments', () => {
    expect(resolveIncomingUrl(`https://${WEB}/bookings/${ID}#access=short`, WEB)).toEqual({
      path: `/trips/${ID}`,
    });
    expect(
      resolveIncomingUrl(`https://${WEB}/bookings/${ID}#access=${TOKEN}&x=<script>`, WEB),
    ).toEqual({ path: `/trips/${ID}` });
  });

  it('opens Home for other hosts, schemes and unknown paths', () => {
    for (const url of [
      `https://evil.example/bookings/${ID}#access=${TOKEN}`,
      `http://${WEB}/bookings/${ID}`,
      `javascript:alert(1)`,
      `https://${WEB}/admin`,
      `https://${WEB}/bookings/not-a-uuid`,
      `https://${WEB}/bookings/${ID}/documents/1`,
      `suskii://settings/debug`,
      `suskii://trips/${ID}/../../account`,
    ]) {
      expect(resolveIncomingUrl(url, WEB)).toEqual({ path: '/' });
    }
    // Without an https website (development builds) web links are never trusted.
    expect(resolveIncomingUrl(`https://${WEB}/deals`, null)).toEqual({ path: '/' });
  });

  it('only accepts guest tokens from the website, never from the app scheme', () => {
    expect(resolveIncomingUrl(`suskii://trips/${ID}#access=${TOKEN}`, WEB)).toEqual({
      path: `/trips/${ID}`,
    });
  });

  it('maps app-scheme paths to their tabs', () => {
    expect(resolveIncomingUrl('suskii://trips', WEB)).toEqual({ path: '/trips' });
    expect(resolveIncomingUrl('suskii://deals', WEB)).toEqual({ path: '/deals' });
    expect(resolveIncomingUrl('suskii://account', WEB)).toEqual({ path: '/account' });
    expect(resolveIncomingUrl('suskii://', WEB)).toEqual({ path: '/' });
    expect(resolveIncomingUrl(`/trips/${ID}`, null)).toEqual({ path: `/trips/${ID}` });
  });

  it('re-serialises valid searches and drops invalid ones', () => {
    const link = resolveIncomingUrl(
      `https://${WEB}/flights/search?trip=one_way&from=LOS&to=ABV&depart=${daysFromToday(30)}&adults=2&utm_source=mail`,
      WEB,
    );
    expect(link.path).toMatch(/^\/search\/flights\?/);
    expect(link.path).toContain('from=LOS');
    expect(link.path).toContain('adults=2');
    expect(link.path).not.toContain('utm_source');

    expect(
      resolveIncomingUrl(`https://${WEB}/flights/search?trip=one_way&from=LOS&to=LOS`, WEB),
    ).toEqual({ path: '/' });
    expect(
      resolveIncomingUrl(
        `suskii://search/hotels?dest=${ID}&checkin=${daysFromToday(30)}&checkout=${daysFromToday(32)}&room=2`,
        WEB,
      ).path,
    ).toMatch(/^\/search\/hotels\?/);
  });

  it('matches the website host case-insensitively', () => {
    expect(resolveIncomingUrl(`https://WWW.SUSKII.EXAMPLE/deals`, WEB)).toEqual({ path: '/deals' });
  });
});

describe('queryInput', () => {
  it('decodes repeated keys, plus signs and bad escapes', () => {
    const input = queryInput('?leg=LOS-ABV&leg=ABV-LOS&q=Port+Harcourt&bad=%E0%A4%A&flag');
    expect(input.getAll('leg')).toEqual(['LOS-ABV', 'ABV-LOS']);
    expect(input.getAll('q')).toEqual(['Port Harcourt']);
    expect(input.getAll('bad')).toEqual(['']);
    expect(input.getAll('flag')).toEqual(['']);
    expect(input.getAll('missing')).toEqual([]);
  });
});

describe('resolveNotificationPath', () => {
  it('accepts trip paths only', () => {
    expect(resolveNotificationPath(`/trips/${ID.toUpperCase()}`)).toBe(`/trips/${ID}`);
    expect(resolveNotificationPath('/account')).toBeNull();
    expect(resolveNotificationPath(`https://evil.example/trips/${ID}`)).toBeNull();
    expect(resolveNotificationPath({ path: `/trips/${ID}` })).toBeNull();
    expect(resolveNotificationPath(undefined)).toBeNull();
  });
});
