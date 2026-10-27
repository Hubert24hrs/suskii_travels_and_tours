/**
 * Google and Apple sign-in on the website, and for the app through it (ADR-067). The provider
 * step is a redirect: the browser leaves for Google or Apple and comes back to
 * `/sign-in/callback` with an ID token in the URL fragment, which never reaches a server log. What
 * the callback needs (provider, state, nonce, where to go next) waits in session storage.
 */
export type SocialProvider = 'google' | 'apple';

export const SOCIAL_PROVIDERS: readonly SocialProvider[] = ['google', 'apple'];
const STORAGE_KEY = 'suskii:social-sign-in';
/** The app's own address for a finished sign-in; the relay never sends a token anywhere else. */
export const APP_RETURN_URL = 'suskii://auth/social';
export const CALLBACK_PATH = '/sign-in/callback';

const TOKEN = /^[A-Za-z0-9_-]{16,256}$/;

export interface PendingSocialSignIn {
  provider: SocialProvider;
  state: string;
  nonce: string;
  /** Where the site goes once signed in. */
  next: string | null;
  referralCode: string | null;
  /** Set when the app asked: the token goes back to it with the app's own state. */
  appState: string | null;
}

export const isSocialProvider = (value: unknown): value is SocialProvider =>
  value === 'google' || value === 'apple';

/** A nonce or state as the API and the app make them (base64url, no padding). */
export const isWellFormedToken = (value: unknown): value is string =>
  typeof value === 'string' && TOKEN.test(value);

export function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The provider's sign-in page for an ID token carrying `nonce`, returning to `redirectUri`. */
export function authorizeUrl(
  provider: SocialProvider,
  input: { clientId: string; redirectUri: string; nonce: string; state: string },
): string {
  if (provider === 'google') {
    return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'id_token',
      scope: 'openid email profile',
      nonce: input.nonce,
      state: input.state,
      prompt: 'select_account',
    }).toString()}`;
  }
  // Apple returns tokens in the fragment only without scopes; the account is found by its
  // subject (and the email, when Apple includes it).
  return `https://appleid.apple.com/auth/authorize?${new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code id_token',
    response_mode: 'fragment',
    nonce: input.nonce,
    state: input.state,
  }).toString()}`;
}

export function savePending(pending: PendingSocialSignIn): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
}

/** The pending sign-in, read once: a second read (a reload, a replay) finds nothing. */
export function takePending(): PendingSocialSignIn | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingSocialSignIn>;
    if (!isSocialProvider(value.provider)) return null;
    if (!isWellFormedToken(value.state) || !isWellFormedToken(value.nonce)) return null;
    return {
      provider: value.provider,
      state: value.state,
      nonce: value.nonce,
      next: typeof value.next === 'string' ? value.next : null,
      referralCode: typeof value.referralCode === 'string' ? value.referralCode : null,
      appState: isWellFormedToken(value.appState) ? value.appState : null,
    };
  } catch {
    return null;
  }
}

/** The ID token and state from the provider's redirect, or the error it reported. */
export function readCallback(hash: string): { idToken: string | null; state: string | null } {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return { idToken: params.get('id_token'), state: params.get('state') };
}
