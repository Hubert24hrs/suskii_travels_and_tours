import { secureStorage } from './secure-storage';

/**
 * Guest support access in the app (ADR-083): the token returned when a guest starts a
 * conversation lives in the secure store on this device, like guest booking tokens.
 */
const supportKey = (conversationId: string): string => `support.${conversationId}`;

export const supportTokens = {
  save: (conversationId: string, token: string): Promise<void> =>
    secureStorage.set(supportKey(conversationId), token),
  headers: async (conversationId: string): Promise<Record<string, string>> => {
    const token = await secureStorage.get(supportKey(conversationId));
    return token ? { 'X-Support-Token': token } : {};
  },
};

/** How often an open conversation asks for new messages while on screen. */
export const SUPPORT_POLL_MS = 4_000;
