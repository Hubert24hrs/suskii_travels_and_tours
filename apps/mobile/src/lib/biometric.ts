import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { preferences } from './cache';

/**
 * Fingerprint sign-in (ADR-067). The device credential lives in the secure store behind the
 * system biometric prompt (Android Keystore key that needs a fresh fingerprint or face, iOS
 * Keychain with Face ID / Touch ID), on this device only. A plain flag in preferences says it is
 * set up, so the sign-in screen can offer it without prompting.
 */
const KEY = 'auth.device-credential';
const FLAG = 'fingerprint-sign-in';

export interface DeviceCredential {
  credentialId: string;
  secret: string;
}

const options = (prompt: string): SecureStore.SecureStoreOptions => ({
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  requireAuthentication: true,
  authenticationPrompt: prompt,
});

export const biometrics = {
  /** True when the phone has a fingerprint or face enrolled that apps may use. */
  async available(): Promise<boolean> {
    try {
      const [hardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      return hardware && enrolled && SecureStore.canUseBiometricAuthentication();
    } catch {
      return false;
    }
  },

  /** Whether fingerprint sign-in is set up on this phone (no prompt). */
  enabled(): boolean {
    return biometrics.credentialId() !== null;
  },

  /** The credential's id (not a secret), so it can be turned off without a prompt. */
  credentialId(): string | null {
    return preferences.getString(FLAG) ?? null;
  },

  /** Stores the credential behind the biometric prompt; false when the phone refused. */
  async save(credential: DeviceCredential, prompt: string): Promise<boolean> {
    try {
      await SecureStore.setItemAsync(KEY, JSON.stringify(credential), options(prompt));
      preferences.set(FLAG, credential.credentialId);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Asks for the fingerprint and returns the credential, 'cancelled' when the person backed out,
   * or null when it is gone (biometrics changed, store cleared): then it is forgotten.
   */
  async read(prompt: string): Promise<DeviceCredential | 'cancelled' | null> {
    try {
      const raw = await SecureStore.getItemAsync(KEY, options(prompt));
      const value = raw ? (JSON.parse(raw) as Partial<DeviceCredential>) : null;
      if (typeof value?.credentialId === 'string' && typeof value.secret === 'string') {
        return { credentialId: value.credentialId, secret: value.secret };
      }
    } catch (error) {
      if (/cancel/i.test(String((error as Error | undefined)?.message))) return 'cancelled';
    }
    await biometrics.forget();
    return null;
  },

  async forget(): Promise<void> {
    preferences.remove(FLAG);
    try {
      await SecureStore.deleteItemAsync(KEY, {
        keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
      });
    } catch {
      // Already gone.
    }
  },
};
