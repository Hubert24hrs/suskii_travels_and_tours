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
// Cars (ADR-050).
export const driverNinContext = (driverId: string): string => `driver:${driverId}:nin`;
export const driverLicenceContext = (driverId: string): string => `driver:${driverId}:licence`;
export const driverPayoutContext = (driverId: string): string =>
  `driver:${driverId}:payout-account`;
export const driverDocumentKeyContext = (documentId: string): string =>
  `driver-document:${documentId}`;
export const ridePinContext = (rideId: string): string => `ride:${rideId}:pin`;
export const emergencyContactContext = (contactId: string): string =>
  `emergency-contact:${contactId}`;
export const rentalLicenceNumberContext = (licenceId: string): string =>
  `rental-licence:${licenceId}:number`;
export const rentalLicenceKeyContext = (licenceId: string): string => `rental-licence:${licenceId}`;
export const rentalPhotoKeyContext = (photoId: string): string => `rental-photo:${photoId}`;
