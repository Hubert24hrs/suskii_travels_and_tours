import { color } from '@suskii/design-tokens';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * App variants (ADR-024). `APP_VARIANT` picks the bundle id suffix, the display name and whether a
 * plain-http API is allowed; only development and e2e builds may talk to http hosts.
 */
const VARIANTS = ['development', 'preview', 'production', 'e2e'] as const;
type Variant = (typeof VARIANTS)[number];

function readVariant(): Variant {
  const value = process.env.APP_VARIANT ?? 'development';
  if (!(VARIANTS as readonly string[]).includes(value))
    throw new Error(`APP_VARIANT must be one of ${VARIANTS.join(', ')}`);
  return value as Variant;
}

const variant = readVariant();
/** Owner decision (placeholder until the store listings exist). */
const baseId = process.env.APP_BUNDLE_ID ?? 'com.suskii.travels';
const bundleId =
  variant === 'production' ? baseId : `${baseId}.${variant === 'development' ? 'dev' : variant}`;
const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const webUrl = process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'http://localhost:3000';
const insecureAllowed = variant === 'development' || variant === 'e2e';
const nativeAttestation = process.env.EXPO_PUBLIC_ATTESTATION !== 'mock';
const projectId = process.env.EAS_PROJECT_ID;

for (const [name, url] of [
  ['EXPO_PUBLIC_API_BASE_URL', apiUrl],
  ['EXPO_PUBLIC_WEB_BASE_URL', webUrl],
] as const) {
  if (!insecureAllowed && !url.startsWith('https://'))
    throw new Error(`${name} must use https for the ${variant} variant`);
}
if (variant === 'production' && !nativeAttestation)
  throw new Error('Production builds must use native attestation (EXPO_PUBLIC_ATTESTATION)');

// App links only for https hosts: Android verifies them and iOS requires TLS (ADR-021).
const webHost = new URL(webUrl).host;
const appLinks = webUrl.startsWith('https://');
const linkPaths = [
  { pathPrefix: '/bookings/' },
  { path: '/flights/search' },
  { path: '/hotels/search' },
  { path: '/deals' },
];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: variant === 'production' ? 'Suskii Travels' : `Suskii Travels (${variant})`,
  slug: 'suskii-travels',
  scheme: 'suskii',
  version: '0.1.0',
  orientation: 'portrait',
  // Design tokens define a light theme only.
  userInterfaceStyle: 'light',
  platforms: ['ios', 'android'],
  runtimeVersion: { policy: 'fingerprint' },
  updates: projectId ? { url: `https://u.expo.dev/${projectId}` } : { enabled: false },
  ios: {
    bundleIdentifier: bundleId,
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
    ...(appLinks ? { associatedDomains: [`applinks:${webHost}`] } : {}),
    ...(nativeAttestation
      ? {
          entitlements: {
            'com.apple.developer.devicecheck.appattest-environment':
              variant === 'production' ? 'production' : 'development',
          },
        }
      : {}),
  },
  android: {
    package: bundleId,
    // Trips, documents and the secure store never leave the device through backups (ADR-020).
    allowBackup: false,
    ...(appLinks
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: linkPaths.map((path) => ({ scheme: 'https', host: webHost, ...path })),
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        }
      : {}),
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    'expo-web-browser',
    ['expo-notifications', { color: color.primary, defaultChannel: 'bookings' }],
    ['expo-build-properties', { android: { usesCleartextTraffic: insecureAllowed } }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    variant,
    ...(projectId ? { eas: { projectId } } : {}),
  },
});
