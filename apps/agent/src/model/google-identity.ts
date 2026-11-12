/**
 * Short-lived Google access tokens for the identity of the machine this service runs on (a
 * Compute Engine VM, Cloud Run or Cloud Build), read from its metadata server (ADR-112). No key
 * is stored or configured anywhere: a token lasts about an hour, is kept in memory only and is
 * fetched again a few minutes before it ends. The metadata server answers on a link-local
 * address that never leaves the host, which is why this one request is plain http.
 */
const TOKEN_URL =
  'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token';
/** A token is replaced this long before it ends, so a model call never carries a dying one. */
const REFRESH_EARLY_MS = 5 * 60_000;
const TIMEOUT_MS = 5_000;

/** Hands out a valid access token, or throws; never logs or repeats one. */
export type AccessTokenSource = () => Promise<string>;

export interface MetadataTokenOptions {
  /** Tests answer requests themselves; production uses the platform's fetch. */
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

/**
 * The machine's own token from its metadata server. Concurrent callers share one request, and a
 * failed request is not remembered: the next call asks again.
 */
export function metadataTokenSource({
  fetch = globalThis.fetch,
  now = Date.now,
}: MetadataTokenOptions = {}): AccessTokenSource {
  let held: { token: string; endsAt: number } | null = null;
  let pending: Promise<string> | null = null;

  const ask = async (): Promise<string> => {
    const response = await fetch(TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Status codes only: an error body is the server's, and a success body holds the token.
    if (!response.ok) throw new Error(`metadata server answered ${response.status}`);
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (
      typeof body.access_token !== 'string' ||
      body.access_token.length === 0 ||
      typeof body.expires_in !== 'number' ||
      !(body.expires_in > 0)
    ) {
      throw new Error('metadata server sent no usable token');
    }
    held = { token: body.access_token, endsAt: now() + body.expires_in * 1000 };
    return body.access_token;
  };

  return () => {
    if (held && held.endsAt - REFRESH_EARLY_MS > now()) return Promise.resolve(held.token);
    pending ??= ask().finally(() => {
      pending = null;
    });
    return pending;
  };
}
