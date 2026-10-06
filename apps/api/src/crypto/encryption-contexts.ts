/**
 * Every context string field encryption binds a ciphertext to (additional authenticated data).
 * One module so the services, the re-encryption registry (`ENCRYPTED_FIELDS`) and the
 * cryptography inventory cannot drift apart. A context names the row (and column) the value
 * belongs to; a ciphertext copied anywhere else fails to decrypt.
 */
export const factorContext = (userId: string): string => `mfa-factor:${userId}:totp`;
export const contactContext = (bookingId: string): string => `booking:${bookingId}:contact`;
export const passportContext = (kind: 'booking-passenger' | 'traveller', id: string): string =>
  `${kind}:${id}:passport`;
export const addonDetailsContext = (itemId: string): string =>
  `booking-item:${itemId}:addon-details`;
export const voucherContext = (voucherId: string): string => `booking-voucher:${voucherId}`;
export const noteContext = (noteId: string): string => `booking-note:${noteId}`;
export const pushTokenContext = (id: string): string => `push-token:${id}`;
export const idempotencySealContext = (id: string): string => `idempotency:${id}:response`;
export const documentKeyContext = (documentId: string): string => `visa-document:${documentId}`;
export const documentNameContext = (documentId: string): string =>
  `visa-document:${documentId}:name`;
