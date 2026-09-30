import type { Schemas } from '@suskii/api-client';

import { readJson, secureCache, writeJson } from './cache';
import { SECURE_KEYS, secureStorage } from './secure-storage';

export type AuthUser = Schemas['AuthUser'];
type AuthSession = Schemas['AuthSession'];

/** Result of a refresh call: a new session, a dead token, or no answer (offline). */
export type RefreshOutcome = AuthSession | 'invalid' | 'unavailable';

const USER_KEY = 'account.user';

/**
 * The signed-in session (ADR-020): tokens in the secure store, the access token also in memory,
 * the profile in the encrypted cache for offline start. Refreshes are single flight, so parallel
 * 401s rotate the refresh token once (the API revokes the session on reuse).
 */
export class SessionStore {
  private access: string | undefined;
  private refreshValue: string | undefined;
  private inflight: Promise<string | undefined> | null = null;
  private readonly listeners = new Set<() => void>();
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
    this.notify();
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

  async save(session: AuthSession): Promise<void> {
    if (!session.accessToken || !session.refreshToken) throw new Error('token transport expected');
    this.access = session.accessToken;
    this.refreshValue = session.refreshToken;
    this.user = session.user;
    await Promise.all([
      secureStorage.set(SECURE_KEYS.accessToken, session.accessToken),
      secureStorage.set(SECURE_KEYS.refreshToken, session.refreshToken),
    ]);
    writeJson(secureCache(), USER_KEY, session.user);
    this.notify();
  }

  async clear(): Promise<void> {
    this.access = undefined;
    this.refreshValue = undefined;
    this.user = null;
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

  private async rotate(): Promise<string | undefined> {
    const token = this.refreshValue;
    if (!token) return undefined;
    const outcome = await this.refreshCall(token);
    if (outcome === 'unavailable') return undefined;
    if (outcome === 'invalid') {
      await this.clear();
      return undefined;
    }
    await this.save(outcome);
    return this.access;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
