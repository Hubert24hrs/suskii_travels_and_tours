import { createHash } from 'node:crypto';

/** Our own namespace for ids of reference data (RFC 9562, section 6.6): fixed for ever. */
const NAMESPACE = Buffer.from('8f1d7c0a53e64b0e9a6f2d41c7b3e905', 'hex');

/** A name-based UUID (version 5) of `name` under the namespace above. */
function nameUuid(name: string): string {
  const bytes = createHash('sha1').update(NAMESPACE).update(name, 'utf8').digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * The id a city is seeded with: derived from its country and its name, so the same city has the
 * same id in every database built from the reference data. Phones and browsers keep city ids
 * ("Continue your search", a shared hotel search link). With a random id, each of those broke
 * whenever a test server was rebuilt, which the hosted one is every four hours (ADR-092).
 *
 * A city that was seeded before this keeps the id it has: the seed only inserts cities that
 * are missing, and never rewrites an id.
 */
export function stableCityId(countryCode: string, name: string): string {
  return nameUuid(`city:${countryCode.toUpperCase()}|${name}`);
}
