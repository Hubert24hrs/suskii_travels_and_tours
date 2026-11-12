import { generateKeyPairSync } from 'node:crypto';

import { json, mockApi } from '../test/app';
import { ticketSigner as signer } from '../test/tickets';

import { createBareApi } from './api';
import { openSecureCache, secureCache } from './cache';
import { fromBase64, offlineScanner, rawEd25519Key, verifyTicket } from './offline-scan';

const NOW = new Date('2026-11-02T05:00:00.000Z');
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
const claims = (tid: string, patch: Record<string, unknown> = {}) => ({
  tid,
  trp: '0192d3a0-7c1e-7b2a-9f00-00000000c101',
  st: '1A',
  nbf: seconds(NOW) - 3600,
  exp: seconds(NOW) + 3600,
  ...patch,
});
const TICKET_A = '0192d3a0-7c1e-7b2a-9f00-00000000c131';
const TICKET_B = '0192d3a0-7c1e-7b2a-9f00-00000000c132';
const AGENT = '0192d3a0-7c1e-7b2a-9f00-00000000a001';
const OTHER_AGENT = '0192d3a0-7c1e-7b2a-9f00-00000000a002';

/** A client over the fetch `mockApi` installs (created after it). */
const api = () => createBareApi();

describe('offline ticket checks', () => {
  const keys = signer();

  beforeEach(async () => {
    await openSecureCache();
    secureCache().clearAll();
  });

  it('decodes base64 and base64url and refuses anything else', () => {
    expect(Array.from(fromBase64('AQID') ?? [])).toEqual([1, 2, 3]);
    expect(Array.from(fromBase64('-_8') ?? [])).toEqual([251, 255]);
    expect(fromBase64('not base64!')).toBeNull();
  });

  it('takes the raw key out of the SPKI PEM the API publishes, and nothing else', () => {
    expect(rawEd25519Key(keys.spki)).toHaveLength(32);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey;
    const rsaPem = Buffer.from(rsa.export({ type: 'spki', format: 'pem' }).toString());
    expect(rawEd25519Key(rsaPem.toString('base64'))).toBeNull();
  });

  it('accepts a genuine ticket in its window and refuses forged, foreign or stale ones', () => {
    const saved = [
      { kid: keys.kid, key: Buffer.from(rawEd25519Key(keys.spki) ?? []).toString('base64') },
    ];
    const good = keys.ticket(claims(TICKET_A));
    expect(verifyTicket(good, saved, NOW)).toEqual({ result: 'boarded', claims: claims(TICKET_A) });

    // Another seat with the original signature.
    const [prefix, kid, , signature] = good.split('.');
    const forged = `${prefix}.${kid}.${Buffer.from(JSON.stringify(claims(TICKET_A, { st: '9F' }))).toString('base64url')}.${signature}`;
    expect(verifyTicket(forged, saved, NOW)).toEqual({
      result: 'invalid',
      reason: 'bad_signature',
    });

    const stranger = signer();
    expect(verifyTicket(stranger.ticket(claims(TICKET_A)), saved, NOW)).toEqual({
      result: 'invalid',
      reason: 'unknown_key',
    });
    expect(
      verifyTicket(keys.ticket(claims(TICKET_A, { nbf: seconds(NOW) + 60 })), saved, NOW),
    ).toEqual({ result: 'invalid', reason: 'not_yet_valid' });
    expect(
      verifyTicket(keys.ticket(claims(TICKET_A, { exp: seconds(NOW) - 60 })), saved, NOW),
    ).toEqual({ result: 'invalid', reason: 'expired' });
    expect(verifyTicket('SUSKII-T1.only.three', saved, NOW)).toEqual({
      result: 'invalid',
      reason: 'malformed',
    });
    expect(verifyTicket(`${good.slice(0, -4)}%%%%`, saved, NOW)).toEqual({
      result: 'invalid',
      reason: 'malformed',
    });
  });

  it('boards each ticket once on this phone, queues the scans and syncs them in order', async () => {
    const { calls } = mockApi({
      'GET /v1/buses/ticket-keys': () => json({ keys: [{ kid: keys.kid, spki: keys.spki }] }),
      'POST /v1/operator/tickets/sync': () =>
        json({
          results: [
            { result: 'boarded', reason: null, ticket: null },
            { result: 'already_boarded', reason: null, ticket: null },
          ],
        }),
    });
    expect(offlineScanner.scan('anything', AGENT, NOW)).toEqual({ result: 'no_keys' });
    expect(await offlineScanner.refreshKeys(api())).toBe(1);
    expect(offlineScanner.hasKeys()).toBe(true);

    const a = keys.ticket(claims(TICKET_A));
    const b = keys.ticket(claims(TICKET_B, { st: '2A' }));
    expect(offlineScanner.scan(a, AGENT, NOW).result).toBe('boarded');
    const later = new Date(NOW.getTime() + 60_000);
    expect(offlineScanner.scan(a, AGENT, later)).toEqual({
      result: 'already_boarded',
      claims: claims(TICKET_A),
      boardedAt: NOW.toISOString(),
    });
    expect(offlineScanner.scan(b, AGENT, later).result).toBe('boarded');
    expect(offlineScanner.pending(AGENT)).toEqual([
      { qrPayload: a, scannedAt: NOW.toISOString(), agent: AGENT },
      { qrPayload: b, scannedAt: later.toISOString(), agent: AGENT },
    ]);

    const results = await offlineScanner.sync(api(), AGENT);
    expect(results.map((result) => result.result)).toEqual(['boarded', 'already_boarded']);
    const upload = calls.find((call) => call.url.endsWith('/v1/operator/tickets/sync'));
    expect(await upload?.json()).toEqual({
      scans: [
        { qrPayload: a, scannedAt: NOW.toISOString() },
        { qrPayload: b, scannedAt: later.toISOString() },
      ],
    });
    expect(offlineScanner.pending(AGENT)).toEqual([]);
  });

  it('keeps the queue when the upload fails', async () => {
    mockApi({
      'GET /v1/buses/ticket-keys': () => json({ keys: [{ kid: keys.kid, spki: keys.spki }] }),
      'POST /v1/operator/tickets/sync': () => json({ status: 503 }, 503),
    });
    await offlineScanner.refreshKeys(api());
    offlineScanner.scan(keys.ticket(claims(TICKET_A)), AGENT, NOW);
    expect(await offlineScanner.sync(api(), AGENT)).toEqual([]);
    expect(offlineScanner.pending(AGENT)).toHaveLength(1);
  });

  it("uploads only the signed-in agent's scans and keeps scans made during the upload", async () => {
    const a = keys.ticket(claims(TICKET_A));
    const b = keys.ticket(claims(TICKET_B, { st: '2A' }));
    const late = keys.ticket(claims('0192d3a0-7c1e-7b2a-9f00-00000000c133', { st: '3A' }));
    const { calls } = mockApi({
      'GET /v1/buses/ticket-keys': () => json({ keys: [{ kid: keys.kid, spki: keys.spki }] }),
      'POST /v1/operator/tickets/sync': () => {
        // Another scan lands while the upload is on its way.
        offlineScanner.scan(late, AGENT, NOW);
        return json({ results: [{ result: 'boarded', reason: null, ticket: null }] });
      },
    });
    await offlineScanner.refreshKeys(api());
    offlineScanner.scan(a, OTHER_AGENT, NOW);
    offlineScanner.scan(b, AGENT, NOW);

    await offlineScanner.sync(api(), AGENT);

    const bodies = await Promise.all(
      calls
        .filter((call) => call.url.endsWith('/v1/operator/tickets/sync'))
        .map((call) => call.json() as Promise<{ scans: unknown[] }>),
    );
    // The other agent's scan never goes up under this session, and the agent id never leaves.
    expect(bodies[0]).toEqual({ scans: [{ qrPayload: b, scannedAt: NOW.toISOString() }] });
    expect(bodies.flatMap((body) => body.scans)).not.toContainEqual(
      expect.objectContaining({ qrPayload: a }),
    );
    expect(offlineScanner.pending(OTHER_AGENT)).toEqual([
      { qrPayload: a, scannedAt: NOW.toISOString(), agent: OTHER_AGENT },
    ]);
    expect(offlineScanner.pending(AGENT)).toEqual([]);
    expect(bodies.flatMap((body) => body.scans)).toContainEqual({
      qrPayload: late,
      scannedAt: NOW.toISOString(),
    });
  });

  it('forgets keys and boardings on sign-out but keeps recent scans for their agent', async () => {
    mockApi({
      'GET /v1/buses/ticket-keys': () => json({ keys: [{ kid: keys.kid, spki: keys.spki }] }),
    });
    await offlineScanner.refreshKeys(api());
    const old = new Date(NOW.getTime() - 49 * 3_600_000);
    offlineScanner.scan(keys.ticket(claims(TICKET_A, { nbf: seconds(old) - 60 })), AGENT, old);
    offlineScanner.scan(keys.ticket(claims(TICKET_B)), AGENT, NOW);

    offlineScanner.forget(NOW);

    expect(offlineScanner.hasKeys()).toBe(false);
    // Older than the API's offline window: it would only be clamped, so it goes.
    expect(offlineScanner.pending(AGENT)).toEqual([
      expect.objectContaining({ scannedAt: NOW.toISOString() }),
    ]);
    offlineScanner.forget(new Date(NOW.getTime() + 49 * 3_600_000));
    expect(offlineScanner.pending(AGENT)).toEqual([]);
  });

  it('ignores scans queued by builds that did not record the agent', () => {
    secureCache().set(
      'operator.scan-queue',
      JSON.stringify([{ qrPayload: 'SUSKII-T1.a.b.c', scannedAt: NOW.toISOString() }]),
    );
    expect(offlineScanner.pending(AGENT)).toEqual([]);
  });
});
