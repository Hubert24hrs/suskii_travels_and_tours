/**
 * The mobile app's identity for app links and the payment return (ADR-021). Server-only values,
 * read per request; both association files answer 404 until the owner provides them.
 */

/** Paths the app handles; everything else stays on the web. */
export const APP_LINK_PATHS = ['/bookings/*', '/flights/search', '/hotels/search', '/deals'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEME = /^[a-z][a-z0-9+.-]{1,30}$/;
const ANDROID_PACKAGE = /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/;
const SHA256_FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const APPLE_APP_ID = /^[A-Z0-9]{10}\.[a-zA-Z0-9.-]+$/;

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function appScheme(): string {
  const scheme = process.env.MOBILE_APP_SCHEME ?? 'suskii';
  return SCHEME.test(scheme) ? scheme : 'suskii';
}

/** `suskii://trips/{id}` for a valid booking id, else the Trips tab. */
export function appTripUrl(bookingId: string | undefined): string {
  return bookingId && UUID.test(bookingId)
    ? `${appScheme()}://trips/${bookingId.toLowerCase()}`
    : `${appScheme()}://trips`;
}

/** Digital Asset Links statement, or null when the package or fingerprints are missing. */
export function assetLinks(): unknown[] | null {
  const packageName = process.env.MOBILE_ANDROID_PACKAGE ?? '';
  const fingerprints = list(process.env.MOBILE_ANDROID_CERT_SHA256).map((value) =>
    value.toUpperCase(),
  );
  if (!ANDROID_PACKAGE.test(packageName) || fingerprints.length === 0) return null;
  if (!fingerprints.every((value) => SHA256_FINGERPRINT.test(value))) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

/** apple-app-site-association for universal links, or null without app ids (TEAMID.bundle). */
export function appleAppSiteAssociation(): unknown {
  const appIDs = list(process.env.MOBILE_IOS_APP_IDS);
  if (appIDs.length === 0 || !appIDs.every((id) => APPLE_APP_ID.test(id))) return null;
  return {
    applinks: {
      details: [{ appIDs, components: APP_LINK_PATHS.map((path) => ({ '/': path })) }],
    },
  };
}
