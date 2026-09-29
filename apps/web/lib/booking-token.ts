/**
 * Guest booking access tokens (ADR-015) live in the tab's session storage: they survive the trip to
 * the payment page and back, and disappear with the tab. Browser-only; storage may be blocked.
 */
const key = (bookingId: string): string => `suskii.booking.${bookingId}`;

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

/** Request headers that open a guest booking; empty for account bookings. */
export function bookingHeaders(bookingId: string): Record<string, string> {
  const token = readBookingToken(bookingId);
  return token ? { 'X-Booking-Token': token } : {};
}
