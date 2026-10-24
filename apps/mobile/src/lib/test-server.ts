import { preferences } from './cache';

const KEY = 'test-server';

/** Scheme, host (name, IPv4 or bracketed IPv6) and optional port; nothing else. */
const ORIGIN = /^(https?):\/\/([a-z0-9.-]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?\/?$/i;

export interface TestServer {
  /** The API origin, such as http://192.168.1.20:4000. */
  api: string;
  /** The website origin (payment pages, share links), such as http://192.168.1.20:3000. */
  web: string;
}

/** The origin in `value` (http or https, no path, query or credentials), or null. */
export function parseOrigin(value: string): string | null {
  const match = ORIGIN.exec(value.trim());
  if (!match) return null;
  const [, scheme = '', host = '', port] = match;
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65_535)) return null;
  return `${scheme.toLowerCase()}://${host.toLowerCase()}${port ? `:${port}` : ''}`;
}

/**
 * Test builds only (variant `e2e`, ADR-054): the API and website a tester points the app at, such
 * as a stack on their own computer, instead of the hosts built into the app. The app reads it once
 * at start, so a change applies after the app is closed and opened again. Builds for the stores
 * never read it (`appConfig` checks the variant).
 */
export const testServer = {
  read(): TestServer | null {
    const raw = preferences.getString(KEY);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<TestServer>;
      const api = parseOrigin(value.api ?? '');
      const web = parseOrigin(value.web ?? '');
      return api && web ? { api, web } : null;
    } catch {
      return null;
    }
  },

  /** Saves both origins, or returns which of them is not a usable address. */
  save(input: TestServer): { ok: true } | { ok: false; invalid: ('api' | 'web')[] } {
    const api = parseOrigin(input.api);
    const web = parseOrigin(input.web);
    if (!api || !web) {
      return {
        ok: false,
        invalid: [...(api ? [] : ['api' as const]), ...(web ? [] : ['web' as const])],
      };
    }
    preferences.set(KEY, JSON.stringify({ api, web }));
    return { ok: true };
  },

  clear(): void {
    preferences.remove(KEY);
  },
};
