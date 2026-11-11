/**
 * The assistant in this tab (ADR-101, ADR-105): which conversation is open, and a guest's
 * access token for it, in session storage like guest booking and support tokens. Nothing of
 * what was said is kept here: the conversation is read from the API. Browser-only; storage may
 * be blocked, and the chat then starts afresh on each page.
 */
const PREFIX = 'suskii.agent.';
const CURRENT = `${PREFIX}current`;
const ID = /^[0-9a-f-]{36}$/;

const get = (name: string): string | null => {
  try {
    return sessionStorage.getItem(name);
  } catch {
    return null;
  }
};

/** The conversation open in this tab; null when there is none. */
export function currentConversation(): string | null {
  const id = get(CURRENT);
  return id && ID.test(id) ? id : null;
}

export function rememberConversation(conversationId: string | null): void {
  try {
    if (conversationId) sessionStorage.setItem(CURRENT, conversationId);
    else sessionStorage.removeItem(CURRENT);
  } catch {
    // Blocked storage: the chat still works until the page is left.
  }
}

export function saveAgentToken(conversationId: string, token: string): void {
  try {
    sessionStorage.setItem(`${PREFIX}${conversationId}`, token);
  } catch {
    // As above.
  }
}

/** Request headers that open a guest's conversation; empty for an account's. */
export function agentHeaders(conversationId: string): Record<string, string> {
  const token = get(`${PREFIX}${conversationId}`);
  return token ? { 'X-Agent-Token': token } : {};
}

/** Drops the open conversation and every guest token in this tab (signing out calls it). */
export function forgetAgentConversations(): void {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, index) =>
      sessionStorage.key(index),
    );
    for (const name of keys) if (name?.startsWith(PREFIX)) sessionStorage.removeItem(name);
  } catch {
    // Blocked storage holds nothing.
  }
}
