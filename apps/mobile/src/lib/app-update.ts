import { Platform } from 'react-native';

import { appConfig } from '../config';

type Listener = () => void;

/**
 * Set once the API refuses this app version (426 `app-update-required`, MASVS-CODE-2). The root
 * layout then shows only the update screen; nothing clears it until the app is replaced.
 */
class AppUpdateState {
  private value = false;
  private readonly listeners = new Set<Listener>();

  get required(): boolean {
    return this.value;
  }

  markRequired(): void {
    if (this.value) return;
    this.value = true;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Tests only: start each case with a supported app. */
  reset(): void {
    this.value = false;
  }
}

export const appUpdate = new AppUpdateState();

/**
 * The store listing to update from: Google Play by package name on Android, the configured App
 * Store page on iOS. Null when it is not known (an iOS build without EXPO_PUBLIC_IOS_APP_STORE_URL).
 */
export function storeUrl(os: string = Platform.OS): string | null {
  if (os === 'android' && appConfig.androidPackage) {
    return `https://play.google.com/store/apps/details?id=${encodeURIComponent(appConfig.androidPackage)}`;
  }
  if (os === 'ios' && appConfig.iosAppStoreUrl.startsWith('https://apps.apple.com/')) {
    return appConfig.iosAppStoreUrl;
  }
  return null;
}
