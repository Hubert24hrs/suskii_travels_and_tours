/**
 * Guest support access (ADR-083): the token returned when a guest starts a conversation, or the
 * link token from a reply email, lives in the tab's session storage like guest booking tokens.
 * Browser-only; storage may be blocked.
 */
const PREFIX = 'suskii.support.';
const key = (conversationId: string): string => `${PREFIX}${conversationId}`;

export function saveSupportToken(conversationId: string, token: string): void {
  try {
    sessionStorage.setItem(key(conversationId), token);
  } catch {
    // Private mode or blocked storage: the reply email still links to the conversation.
  }
}

/** Request headers that open a guest's conversation; empty for account conversations. */
export function supportHeaders(conversationId: string): Record<string, string> {
  try {
    const token = sessionStorage.getItem(key(conversationId));
    return token ? { 'X-Support-Token': token } : {};
  } catch {
    return {};
  }
}

/** Drops every guest support token in this tab (signing out calls it). */
export function forgetSupportTokens(): void {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, index) =>
      sessionStorage.key(index),
    );
    for (const name of keys) if (name?.startsWith(PREFIX)) sessionStorage.removeItem(name);
  } catch {
    // Blocked storage holds no tokens.
  }
}

/**
 * Adopts the link token from a reply email (`/support/{id}#access={token}`) and removes it from
 * the address bar, so it stays out of history and screenshots. The fragment never reaches the
 * server.
 */
export function adoptSupportLink(conversationId: string): void {
  const match = /^#access=([A-Za-z0-9_.-]{16,256})$/.exec(window.location.hash);
  if (!match?.[1]) return;
  saveSupportToken(conversationId, match[1]);
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search,
  );
}
