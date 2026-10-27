import { webHost } from '../src/config';
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
  initial,
}: {
  path: string;
  initial: boolean;
}): Promise<string> {
  const link = resolveIncomingUrl(path, webHost());
  // A sign-in handed back to the running app stays with the screen that asked for it.
  if (link.path === '') return initial ? '/' : '';
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
