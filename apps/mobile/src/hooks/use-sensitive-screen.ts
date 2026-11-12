import {
  disableAppSwitcherProtectionAsync,
  enableAppSwitcherProtectionAsync,
  usePreventScreenCapture,
} from 'expo-screen-capture';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

const STALE_AFTER_MS = 5 * 60_000;

/**
 * MASVS controls for checkout, payment and document screens (ADR-020): no screenshots or screen
 * recording (Android FLAG_SECURE), a blurred app-switcher snapshot on iOS, and a callback when
 * the app comes back after more than five minutes in the background (to clear passport numbers).
 */
export function useSensitiveScreen(onStale?: () => void): void {
  usePreventScreenCapture();
  const stale = useRef(onStale);
  useEffect(() => {
    stale.current = onStale;
  });

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    enableAppSwitcherProtectionAsync(0.5).catch(() => undefined);
    return () => {
      disableAppSwitcherProtectionAsync().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    let hiddenAt: number | null = null;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') hiddenAt = Date.now();
      if (state === 'active' && hiddenAt !== null) {
        if (Date.now() - hiddenAt > STALE_AFTER_MS) stale.current?.();
        hiddenAt = null;
      }
    });
    return () => subscription.remove();
  }, []);
}
