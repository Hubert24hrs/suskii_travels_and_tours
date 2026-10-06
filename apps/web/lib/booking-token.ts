/**
 * Guest booking access tokens (ADR-015) live in the tab's session storage: they survive the trip to
 * the payment page and back, and disappear with the tab. Browser-only; storage may be blocked.
 */
const PREFIX = 'suskii.booking.';
const key = (bookingId: string): string => `${PREFIX}${bookingId}`;

export function saveBookingToken(bookingId: string, token: string): void {
  try {
    sessionStorage.setItem(key(bookingId), token);
  } catch {
    // Private mode or blocked storage: the confirmation email still carries the booking.
  }
}

export function readBookingToken(bookingId: string): string | null {
  try {
    return sessionStorage.getItem(key(bookingId));
  } catch {
    return null;
  }
}

/**
 * Drops every guest booking token in this tab. Signing out calls it, so the next person at a
 * shared computer cannot reopen a guest booking from the same tab.
 */
export function forgetBookingTokens(): void {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, index) =>
      sessionStorage.key(index),
    );
    for (const name of keys) if (name?.startsWith(PREFIX)) sessionStorage.removeItem(name);
  } catch {
    // Blocked storage holds no tokens.
  }
}

/** Request headers that open a guest booking; empty for account bookings. */
export function bookingHeaders(bookingId: string): Record<string, string> {
  const token = readBookingToken(bookingId);
  return token ? { 'X-Booking-Token': token } : {};
}

/**
 * Adopts the token from an emailed link (`/bookings/{id}#access={token}`, ADR-018) and removes it
 * from the address bar, so it stays out of history, bookmarks and screenshots. The fragment never
 * reaches the server.
 */
export function adoptAccessLink(bookingId: string): void {
  const match = /^#access=([A-Za-z0-9_-]{16,256})$/.exec(window.location.hash);
  if (!match?.[1]) return;
  saveBookingToken(bookingId, match[1]);
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search,
  );
}
