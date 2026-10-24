import { ed25519 } from '@noble/curves/ed25519.js';
import type { Schemas } from '@suskii/api-client';
import { TICKET_QR_PREFIX, type TicketClaims } from '@suskii/shared';

import type { ApiClient } from './api';
import { readJson, secureCache, writeJson } from './cache';

/**
 * Offline boarding for operator agents (ADR-050, P9 flag `CARS_OFFLINE_QR`). Without a
 * connection the scanner checks the Ed25519 signature and boarding window of a ticket QR code
 * against public keys saved while online, boards each ticket once on this phone, and queues the
 * scan; `syncScans` uploads the queue later and the API has the last word (a ticket boarded on two
 * offline phones, or cancelled meanwhile, comes back as a conflict and is audited).
 *
 * What it cannot know offline: cancellations and refunds since the keys were saved, and scans
 * on other phones. Both surface at sync. Everything is kept in the encrypted cache because a
 * valid QR payload is a boarding right.
 */

const KEYS = 'operator.ticket-keys';
const QUEUE = 'operator.scan-queue';
const BOARDED = 'operator.boarded-offline';
/** The API takes up to 200 scans per upload. */
const SYNC_BATCH = 200;
/** An Ed25519 SubjectPublicKeyInfo: this 12-byte header, then the 32-byte key. */
const SPKI_HEADER = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];

interface SavedKey {
  kid: string;
  /** The raw 32-byte public key, base64. */
  key: string;
}

export interface QueuedScan {
  qrPayload: string;
  scannedAt: string;
}

export type OfflineVerdict =
  | { result: 'boarded'; claims: TicketClaims }
  | { result: 'already_boarded'; claims: TicketClaims; boardedAt: string }
  | {
      result: 'invalid';
      reason: 'malformed' | 'bad_signature' | 'unknown_key' | 'not_yet_valid' | 'expired';
    }
  /** No keys saved yet: the phone has never been online on this screen. */
  | { result: 'no_keys' };

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 or base64url to bytes, by hand: Hermes has no Buffer. */
export function fromBase64(value: string): Uint8Array | null {
  const clean = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | BASE64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[index], bytes[index + 1], bytes[index + 2]];
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64[(triple >> 18) & 63] ?? '';
    out += BASE64[(triple >> 12) & 63] ?? '';
    out += index + 1 < bytes.length ? (BASE64[(triple >> 6) & 63] ?? '') : '=';
    out += index + 2 < bytes.length ? (BASE64[triple & 63] ?? '') : '=';
  }
  return out;
}

const ascii = (value: string): Uint8Array => Uint8Array.from(value, (char) => char.charCodeAt(0));

/** The raw key inside a base64 SPKI PEM from `GET /v1/buses/ticket-keys`, or null. */
export function rawEd25519Key(spkiPemBase64: string): Uint8Array | null {
  const pem = fromBase64(spkiPemBase64);
  if (!pem) return null;
  const body = String.fromCharCode(...pem)
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  const der = fromBase64(body);
  if (der?.length !== SPKI_HEADER.length + 32) return null;
  if (SPKI_HEADER.some((byte, index) => der[index] !== byte)) return null;
  return der.slice(SPKI_HEADER.length);
}

function parseClaims(body: string): TicketClaims | null {
  const bytes = fromBase64(body);
  if (!bytes) return null;
  try {
    // Claims are ids, a seat and numbers: ASCII, so no TextDecoder is needed.
    const value: unknown = JSON.parse(String.fromCharCode(...bytes));
    if (typeof value !== 'object' || value === null) return null;
    const { tid, trp, st, nbf, exp } = value as Record<string, unknown>;
    if (
      typeof tid !== 'string' ||
      typeof trp !== 'string' ||
      typeof st !== 'string' ||
      typeof nbf !== 'number' ||
      typeof exp !== 'number'
    ) {
      return null;
    }
    return { tid, trp, st, nbf, exp };
  } catch {
    return null;
  }
}

/** The same checks as the API's `TicketSigner.verify`, against saved keys. */
export function verifyTicket(
  payload: string,
  keys: readonly SavedKey[],
  now: Date,
): Exclude<OfflineVerdict, { result: 'already_boarded' | 'no_keys' }> {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== TICKET_QR_PREFIX) {
    return { result: 'invalid', reason: 'malformed' };
  }
  const [prefix, kid = '', body = '', signature = ''] = parts;
  const saved = keys.find((key) => key.kid === kid);
  const key = saved ? fromBase64(saved.key) : null;
  if (!key) return { result: 'invalid', reason: 'unknown_key' };
  const sig = fromBase64(signature);
  if (sig?.length !== 64) return { result: 'invalid', reason: 'malformed' };
  let ok = false;
  try {
    ok = ed25519.verify(sig, ascii(`${prefix}.${kid}.${body}`), key);
  } catch {
    return { result: 'invalid', reason: 'malformed' };
  }
  if (!ok) return { result: 'invalid', reason: 'bad_signature' };
  const claims = parseClaims(body);
  if (!claims) return { result: 'invalid', reason: 'malformed' };
  const seconds = Math.floor(now.getTime() / 1000);
  if (seconds < claims.nbf) return { result: 'invalid', reason: 'not_yet_valid' };
  if (seconds > claims.exp) return { result: 'invalid', reason: 'expired' };
  return { result: 'boarded', claims };
}

type Boarded = Record<string, { at: string; exp: number }>;

export const offlineScanner = {
  /** Saves the public keys while online; returns how many are usable. */
  async refreshKeys(api: ApiClient): Promise<number> {
    const { data } = await api.GET('/v1/buses/ticket-keys');
    if (!data) return 0;
    const keys = data.keys.flatMap((entry): SavedKey[] => {
      const raw = rawEd25519Key(entry.spki);
      return raw ? [{ kid: entry.kid, key: toBase64(raw) }] : [];
    });
    if (keys.length > 0) writeJson(secureCache(), KEYS, keys);
    return keys.length;
  },

  /** Offline scanning was switched off: stop trusting the saved keys. */
  forgetKeys(): void {
    secureCache().remove(KEYS);
  },

  /** Signing out: nothing an agent scanned may upload under the next account on this phone. */
  forget(): void {
    for (const key of [KEYS, QUEUE, BOARDED]) secureCache().remove(key);
  },

  hasKeys(): boolean {
    return (readJson<SavedKey[]>(secureCache(), KEYS) ?? []).length > 0;
  },

  /** Checks and boards a ticket on this phone, queueing the scan for the API. */
  scan(qrPayload: string, now = new Date()): OfflineVerdict {
    const keys = readJson<SavedKey[]>(secureCache(), KEYS) ?? [];
    if (keys.length === 0) return { result: 'no_keys' };
    const verdict = verifyTicket(qrPayload, keys, now);
    if (verdict.result !== 'boarded') return verdict;
    const seconds = Math.floor(now.getTime() / 1000);
    // Forget boardings whose window has closed; they cannot be scanned again anyway.
    const boarded = Object.fromEntries(
      Object.entries(readJson<Boarded>(secureCache(), BOARDED) ?? {}).filter(
        ([, entry]) => entry.exp >= seconds,
      ),
    );
    const earlier = boarded[verdict.claims.tid];
    if (earlier) {
      return { result: 'already_boarded', claims: verdict.claims, boardedAt: earlier.at };
    }
    boarded[verdict.claims.tid] = { at: now.toISOString(), exp: verdict.claims.exp };
    writeJson(secureCache(), BOARDED, boarded);
    writeJson(secureCache(), QUEUE, [
      ...offlineScanner.pending(),
      { qrPayload, scannedAt: now.toISOString() },
    ]);
    return verdict;
  },

  pending(): QueuedScan[] {
    return readJson<QueuedScan[]>(secureCache(), QUEUE) ?? [];
  },

  /**
   * Uploads queued scans in the order they were made and drops those the API answered. Returns
   * the API's verdicts; anything but `boarded` is a conflict for the agent to look at.
   */
  async sync(api: ApiClient): Promise<Schemas['TicketScanResult'][]> {
    const results: Schemas['TicketScanResult'][] = [];
    let queue = offlineScanner.pending();
    while (queue.length > 0) {
      const batch = queue.slice(0, SYNC_BATCH);
      const { data } = await api.POST('/v1/operator/tickets/sync', { body: { scans: batch } });
      if (!data) break;
      results.push(...data.results);
      // Scans made while this upload ran stay queued.
      queue = offlineScanner.pending().slice(batch.length);
      writeJson(secureCache(), QUEUE, queue);
    }
    return results;
  },
};
