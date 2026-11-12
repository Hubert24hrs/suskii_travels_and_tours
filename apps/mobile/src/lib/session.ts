import type { Schemas } from '@suskii/api-client';

import { preferences, readJson, secureCache, writeJson } from './cache';
import { SECURE_KEYS, secureStorage } from './secure-storage';

export type AuthUser = Schemas['AuthUser'];
type AuthSession = Schemas['AuthSession'];

/** Result of a refresh call: a new session, a dead token, or no answer (offline). */
export type RefreshOutcome = AuthSession | 'invalid' | 'unavailable';

const USER_KEY = 'account.user';
/** Set while a session that is not remembered runs. A marker only: it holds nothing of it. */
const UNREMEMBERED_KEY = 'session.unremembered';

/**
 * The signed-in session (ADR-020): tokens in the secure store, the access token also in memory,
 * the profile in the encrypted cache for offline start. Refreshes are single flight, so parallel
 * 401s rotate the refresh token once (the API revokes the session on reuse).
 *
 * A sign-in without "Remember me" (ADR-108) keeps all of that in memory only, so it ends when
 * the app closes; what the account left on the phone is then cleared at the next start
 * (`takeEndedWithApp`).
 */
export class SessionStore {
  private access: string | undefined;
  private refreshValue: string | undefined;
  private inflight: Promise<string | undefined> | null = null;
  private remembered = true;
  private endedWithApp = false;
  private readonly listeners = new Set<() => void>();
  private readonly revokedListeners = new Set<() => void>();
  user: AuthUser | null = null;

  constructor(private readonly refreshCall: (refreshToken: string) => Promise<RefreshOutcome>) {}

  async load(): Promise<void> {
    const [access, refresh] = await Promise.all([
      secureStorage.get(SECURE_KEYS.accessToken),
      secureStorage.get(SECURE_KEYS.refreshToken),
    ]);
    this.access = access ?? undefined;
    this.refreshValue = refresh ?? undefined;
    this.user = this.refreshValue ? readJson<AuthUser>(secureCache(), USER_KEY) : null;
    // The last session was not to be remembered and the app closed on it: its tokens were
    // never stored, and what the account kept on this phone still has to go.
    if (!this.refreshValue && preferences.getBoolean(UNREMEMBERED_KEY) === true) {
      this.endedWithApp = true;
    }
    preferences.remove(UNREMEMBERED_KEY);
    this.notify();
  }

  /**
   * True once after a start that found a session ended by closing the app: the caller clears
   * the account's data on this phone, as a sign-out would have.
   */
  takeEndedWithApp(): boolean {
    const ended = this.endedWithApp;
    this.endedWithApp = false;
    return ended;
  }

  get signedIn(): boolean {
    return this.refreshValue !== undefined && this.user !== null;
  }

  accessToken(): string | undefined {
    return this.access;
  }

  refreshToken(): string | undefined {
    return this.refreshValue;
  }

  /**
   * Takes a new session. `remember` is the sign-in form's "Remember me"; a refresh leaves it
   * out and keeps what the sign-in chose.
   */
  async save(session: AuthSession, options: { remember?: boolean } = {}): Promise<void> {
    if (!session.accessToken || !session.refreshToken) throw new Error('token transport expected');
    if (options.remember !== undefined) this.remembered = options.remember;
    this.access = session.accessToken;
    this.refreshValue = session.refreshToken;
    this.user = session.user;
    if (this.remembered) {
      await Promise.all([
        secureStorage.set(SECURE_KEYS.accessToken, session.accessToken),
        secureStorage.set(SECURE_KEYS.refreshToken, session.refreshToken),
      ]);
      writeJson(secureCache(), USER_KEY, session.user);
      preferences.remove(UNREMEMBERED_KEY);
    } else {
      // Nothing of this session is written down; an earlier one's tokens go too.
      await Promise.all([
        secureStorage.remove(SECURE_KEYS.accessToken),
        secureStorage.remove(SECURE_KEYS.refreshToken),
      ]);
      secureCache().remove(USER_KEY);
      preferences.set(UNREMEMBERED_KEY, true);
    }
    this.notify();
  }

  /** Keeps the offline profile in step after the account changes it (name, phone). */
  replaceUser(user: AuthUser): void {
    if (!this.refreshValue) return;
    this.user = user;
    if (this.remembered) writeJson(secureCache(), USER_KEY, user);
    this.notify();
  }

  async clear(): Promise<void> {
    this.access = undefined;
    this.refreshValue = undefined;
    this.user = null;
    this.remembered = true;
    preferences.remove(UNREMEMBERED_KEY);
    await Promise.all([
      secureStorage.remove(SECURE_KEYS.accessToken),
      secureStorage.remove(SECURE_KEYS.refreshToken),
    ]);
    secureCache().remove(USER_KEY);
    this.notify();
  }

  refresh(): Promise<string | undefined> {
    this.inflight ??= this.rotate().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Runs `listener` after the API rejects the refresh token (signed out on another device, the
   * password changed, the session revoked) and the tokens are gone, so the account's data on this
   * phone can go too.
   */
  onRevoked(listener: () => void): () => void {
    this.revokedListeners.add(listener);
    return () => {
      this.revokedListeners.delete(listener);
    };
  }

  private async rotate(): Promise<string | undefined> {
    const token = this.refreshValue;
    if (!token) return undefined;
    const outcome = await this.refreshCall(token);
    // Signed out, or into another account, while the call ran: the answer is the old session's.
    if (this.refreshValue !== token) return undefined;
    if (outcome === 'unavailable') return undefined;
    if (outcome === 'invalid') {
      await this.clear();
      for (const listener of this.revokedListeners) listener();
      return undefined;
    }
    await this.save(outcome);
    return this.access;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
