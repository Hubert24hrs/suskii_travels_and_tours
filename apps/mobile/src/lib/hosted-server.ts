import { preferences } from './cache';
import { parseOrigin, type TestServer } from './test-server';

const CACHE_KEY = 'hosted-test-server';
const TIMEOUT_MS = 4_000;

export interface HostedServer extends TestServer {
  /** When the hosted run stops on its own (ISO 8601). */
  expiresAt: string;
}

/**
 * The hosted test server's address from its discovery document (test-server.yml, ADR-066), or
 * null unless it is running, not past its end, and both origins use https.
 */
export function parseHostedServer(value: unknown, now: number = Date.now()): HostedServer | null {
  if (typeof value !== 'object' || value === null) return null;
  const doc = value as Record<string, unknown>;
  if (doc.version !== 1 || doc.status !== 'running' || typeof doc.expiresAt !== 'string') {
    return null;
  }
  const api = typeof doc.api === 'string' ? parseOrigin(doc.api) : null;
  const web = typeof doc.web === 'string' ? parseOrigin(doc.web) : null;
  if (!api?.startsWith('https://') || !web?.startsWith('https://')) return null;
  if (!(Date.parse(doc.expiresAt) > now)) return null;
  return { api, web, expiresAt: doc.expiresAt };
}

function cached(now: number): HostedServer | null {
  const raw = preferences.getString(CACHE_KEY);
  if (!raw) return null;
  try {
    return parseHostedServer({ version: 1, status: 'running', ...JSON.parse(raw) }, now);
  } catch {
    return null;
  }
}

/**
 * Test builds only: asks where the hosted test server runs. The answer is remembered, so a start
 * without a connection uses the last address until it expires; a document that says the server
 * stopped forgets it. Never throws, and gives up after four seconds.
 */
export async function discoverHostedServer(
  url: string,
  {
    fetchImpl = globalThis.fetch,
    now = Date.now,
  }: { fetchImpl?: typeof globalThis.fetch; now?: () => number } = {},
): Promise<HostedServer | null> {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // A GitHub release asset: the download redirects to its storage host.
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    if (response.ok || response.status === 404) {
      const found = response.ok ? parseHostedServer(await response.json(), now()) : null;
      if (found) preferences.set(CACHE_KEY, JSON.stringify(found));
      else preferences.remove(CACHE_KEY);
      return found;
    }
  } catch {
    // Offline or slow: fall back to the last address we saw.
  } finally {
    clearTimeout(timer);
  }
  return cached(now());
}
