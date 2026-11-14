import { browserApi } from '../../lib/browser-api';
import { savePdf } from '../../lib/save-pdf';

/**
 * A paid combined trip's receipt (ADR-099) as a download, read with the visitor's session and
 * named here. False when the API had none to give (a trip not paid yet) or the read failed, so
 * the caller can say so; the receipt is never cached in the browser.
 */
export async function saveTripReceipt(trip: { id: string; reference: string }): Promise<boolean> {
  try {
    const { data } = await browserApi().GET('/v1/trips/{tripId}/receipt', {
      params: { path: { tripId: trip.id } },
      parseAs: 'blob',
    });
    return savePdf(data, `suskii-receipt-${trip.reference}.pdf`);
  } catch {
    return false;
  }
}
