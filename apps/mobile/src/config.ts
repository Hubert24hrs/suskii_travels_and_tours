import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { testServer } from './lib/test-server';

interface ExtraConfig {
  variant?: string;
  eas?: { projectId?: string };
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;
const variant = extra.variant ?? 'development';
/** Test builds can point at the tester's own stack (ADR-054); every other build ignores it. */
const server = variant === 'e2e' ? testServer.read() : null;

/**
 * Build-time public configuration (EXPO_PUBLIC_* values are inlined by Babel and visible in the
 * bundle, so nothing secret belongs here; CI scans the bundle, ADR-024).
 */
export const appConfig = {
  apiBaseUrl:
    server?.api ??
    (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  webBaseUrl:
    server?.web ??
    (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  /** `mock` in development and e2e builds only (ADR-023). */
  attestation: process.env.EXPO_PUBLIC_ATTESTATION === 'mock' ? 'mock' : 'native',
  /** Google Cloud project number for Play Integrity (public identifier, not a secret). */
  playIntegrityProject: process.env.EXPO_PUBLIC_PLAY_INTEGRITY_PROJECT_NUMBER ?? '',
  /** Sentry DSN for JavaScript error reports (public by design; ADR-046). Empty: none sent. */
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
  /** App Store page for the update screen on iOS; Android links to Google Play by package. */
  iosAppStoreUrl: process.env.EXPO_PUBLIC_IOS_APP_STORE_URL ?? '',
  /** Android application id (Google Play listing). */
  androidPackage: Constants.expoConfig?.android?.package ?? '',
  /** EAS project id: needed for Expo push tokens and updates. */
  easProjectId: extra.eas?.projectId,
  variant,
  /** True when this test build uses a server the tester chose (ADR-054). */
  customServer: server !== null,
  version: Constants.expoConfig?.version ?? '0.0.0',
} as const;

/** Sent as X-Suskii-Client: mobile pricing channel and the app payment return (ADR-021). */
export const CLIENT_ID = `mobile-${Platform.OS}/${appConfig.version}`;

/** The web host whose https links the app accepts (app links), when it uses TLS. */
export const WEB_HOST = appConfig.webBaseUrl.startsWith('https://')
  ? new URL(appConfig.webBaseUrl).host
  : null;
