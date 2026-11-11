import { secureStorage } from './secure-storage';

/**
 * The assistant on this device (ADR-101, ADR-105): which conversation is open and, for a
 * guest, the access token returned when it started. Both live in the secure store, like guest
 * booking and support tokens. Nothing of what was said is kept: the conversation is read from
 * the API each time.
 */
const CURRENT = 'agent.current';
const tokenKey = (conversationId: string): string => `agent.${conversationId}`;
const ID = /^[0-9a-f-]{36}$/i;

export const assistantSession = {
  saveToken: (conversationId: string, token: string): Promise<void> =>
    secureStorage.set(tokenKey(conversationId), token),
  /** Request headers that open a guest's conversation; empty for an account's. */
  headers: async (conversationId: string): Promise<Record<string, string>> => {
    const token = await secureStorage.get(tokenKey(conversationId));
    return token ? { 'X-Agent-Token': token } : {};
  },
  /** The conversation last opened on this device; null when there is none. */
  current: async (): Promise<string | null> => {
    const id = await secureStorage.get(CURRENT);
    return id && ID.test(id) ? id : null;
  },
  remember: (conversationId: string | null): Promise<void> =>
    conversationId ? secureStorage.set(CURRENT, conversationId) : secureStorage.remove(CURRENT),
};

/** How often a conversation is read again while the assistant is answering. */
export const ASSISTANT_POLL_MS = 1_500;
