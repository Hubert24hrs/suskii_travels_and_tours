import { WEB_HOST } from '../src/config';
import { openSecureCache } from '../src/lib/cache';
import { resolveIncomingUrl } from '../src/lib/deep-links';
import { tripStore } from '../src/lib/trips';

/**
 * Every link the system delivers passes through here before the router (ADR-021): only
 * allowlisted paths survive, and a guest token from an emailed booking link goes to the secure
 * store instead of the route.
 */
export async function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): Promise<string> {
  const link = resolveIncomingUrl(path, WEB_HOST);
  if (link.access) {
    try {
      await openSecureCache();
      await tripStore.addGuestTrip(link.access.bookingId, link.access.token);
    } catch {
      // The trip still opens; without the token it shows as not found.
    }
  }
  return link.path;
}
