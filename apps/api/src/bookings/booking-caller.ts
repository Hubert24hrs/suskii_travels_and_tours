import { ATTESTATION_HEADER_NAME } from '../attestation/attestation.service';
import type { AuthenticatedRequest } from '../auth/auth-context';
import { requestContext } from '../common/request-context';
import { clientContext } from '../search/client-context';

import type { BookingCaller } from './bookings.service';

function header(request: AuthenticatedRequest, name: string): string {
  const value = request.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/** Who is asking about a booking: pricing client, request metadata, guest token, attestation. */
export function bookingCaller(request: AuthenticatedRequest): BookingCaller {
  const token = header(request, 'x-booking-token');
  const attestation = header(request, ATTESTATION_HEADER_NAME);
  return {
    client: clientContext(request),
    context: requestContext(request),
    token: token.length > 0 && token.length <= 128 ? token : null,
    attestation: attestation.length > 0 ? attestation : null,
  };
}
