import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { hostInDomain } from '@suskii/shared';

/** Why an address may not be fetched. A code, so nothing about the target is echoed. */
export type FetchRefusal =
  | 'not_https'
  | 'credentials'
  | 'port'
  | 'host_outside_policy'
  | 'ip_literal'
  | 'unresolvable'
  | 'private_address';

export class FetchRefused extends Error {
  constructor(readonly code: FetchRefusal) {
    super(`fetch refused: ${code}`);
    this.name = 'FetchRefused';
  }
}

const v4 = (address: string): number[] => address.split('.').map((part) => Number(part));

/** True for an IPv4 address the public internet does not route to a public host. */
function privateV4(address: string): boolean {
  const [a = 0, b = 0, c = 0] = v4(address);
  return (
    a === 0 || // this network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // documentation
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) || // documentation
    a >= 224 // multicast, reserved, broadcast
  );
}

/** True for an IPv6 address that is not a public unicast address. */
function privateV6(address: string): boolean {
  const lower = address.toLowerCase().replace(/%.*$/, '');
  if (lower === '::' || lower === '::1') return true;
  // IPv4-mapped and IPv4-compatible addresses carry an IPv4 address: judge that one.
  const mapped = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped?.[1]) return privateV4(mapped[1]);
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hexMapped?.[1] && hexMapped[2]) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    return privateV4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  // "::1" and the like start with an empty group, which is zero.
  const head = lower.split(':')[0] ?? '';
  const first = parseInt(head === '' ? '0' : head, 16);
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xff00) === 0xff00 || // multicast
    lower.startsWith('64:ff9b:') || // NAT64: reaches IPv4 addresses
    lower.startsWith('2001:db8:') || // documentation
    first === 0 // unspecified and other ::/16 forms
  );
}

/** True when `address` must never be fetched: loopback, private, link-local and the like. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return privateV4(address);
  if (family === 6) return privateV6(address);
  return true;
}

/**
 * Checks an address Suskii builds itself before anything fetches it (ADR-102): https only, no
 * credentials, the default port, a host name (never an IP literal) on the policy's own domain.
 * Returns the parsed address. It does not resolve the name: `resolvePublic` does, at connect
 * time, so a name cannot change its answer between the check and the connection.
 */
export function assertFetchable(address: string, policyDomain: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new FetchRefused('not_https');
  }
  if (url.protocol !== 'https:') throw new FetchRefused('not_https');
  if (url.username !== '' || url.password !== '') throw new FetchRefused('credentials');
  if (url.port !== '' && url.port !== '443') throw new FetchRefused('port');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) throw new FetchRefused('ip_literal');
  if (!hostInDomain(host, policyDomain)) throw new FetchRefused('host_outside_policy');
  return url;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;

const systemResolver: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * Resolves a host and returns its public addresses. One private address among the answers
 * refuses the whole name: a name that answers with both is not one we connect to.
 */
export async function resolvePublic(
  host: string,
  resolver: Resolver = systemResolver,
): Promise<{ address: string; family: number }[]> {
  let answers: { address: string; family: number }[];
  try {
    answers = await resolver(host);
  } catch {
    throw new FetchRefused('unresolvable');
  }
  if (answers.length === 0) throw new FetchRefused('unresolvable');
  if (answers.some((answer) => isPrivateAddress(answer.address))) {
    throw new FetchRefused('private_address');
  }
  return answers;
}
