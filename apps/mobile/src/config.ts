import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { HostedServer } from './lib/hosted-server';
import { testServer, type TestServer } from './lib/test-server';

interface ExtraConfig {
  variant?: string;
  eas?: { projectId?: string };
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;
const variant = extra.variant ?? 'development';
const testBuild = variant === 'e2e';
/** Test builds can point at the tester's own stack (ADR-054); every other build ignores it. */
const custom = testBuild ? testServer.read() : null;
const builtIn: TestServer = {
  api: (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  web: (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
};
/** The hosted test server a test build found at start (ADR-066), when the tester chose none. */
let hosted: HostedServer | null = null;
const serverListeners = new Set<() => void>();

const server = (): TestServer => custom ?? hosted ?? builtIn;

/**
 * Test builds only: use the hosted test server found by `discoverHostedServer()`, or stop using
 * it (null). A server the tester chose (ADR-054) still wins. Listeners hear about real changes.
 */
export function setHostedServer(next: HostedServer | null): void {
  if (!testBuild) return;
  const moved = next?.api !== hosted?.api || next?.web !== hosted?.web;
  hosted = next;
  if (moved) for (const listener of serverListeners) listener();
}

/** Called when the server the app talks to changes (the hosted test server moved). */
export function subscribeServer(listener: () => void): () => void {
  serverListeners.add(listener);
  return () => serverListeners.delete(listener);
}

/**
 * Build-time public configuration (EXPO_PUBLIC_* values are inlined by Babel and visible in the
 * bundle, so nothing secret belongs here; CI scans the bundle, ADR-024).
 */
export const appConfig = {
  get apiBaseUrl(): string {
    return server().api;
  },
  get webBaseUrl(): string {
    return server().web;
  },
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
  customServer: custom !== null,
  /** True when this test build uses the hosted test server (ADR-066). */
  get hostedServer(): boolean {
    return custom === null && hosted !== null;
  },
  /** When the hosted test server stops on its own (ISO 8601), while the app uses it. */
  get hostedServerExpiresAt(): string | null {
    return custom === null ? (hosted?.expiresAt ?? null) : null;
  },
  /** Test builds: where the hosted test server publishes its address, and where to start it. */
  testServerDiscoveryUrl: testBuild ? (process.env.EXPO_PUBLIC_TEST_SERVER_URL ?? '') : '',
  testServerStartUrl: testBuild ? (process.env.EXPO_PUBLIC_TEST_SERVER_START_URL ?? '') : '',
  version: Constants.expoConfig?.version ?? '0.0.0',
} as const;

/** Sent as X-Suskii-Client: mobile pricing channel and the app payment return (ADR-021). */
export const CLIENT_ID = `mobile-${Platform.OS}/${appConfig.version}`;

/** The web host whose https links the app accepts (app links), when it uses TLS. */
export function webHost(): string | null {
  return appConfig.webBaseUrl.startsWith('https://') ? new URL(appConfig.webBaseUrl).host : null;
}
