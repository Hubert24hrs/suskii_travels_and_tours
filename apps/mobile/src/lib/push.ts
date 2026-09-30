import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { appConfig } from '../config';

import type { ApiClient } from './api';
import { preferences } from './cache';

const ASKED_KEY = 'push.asked';

/** Foreground notifications show a banner; nothing plays a sound or changes the badge. */
export function configureNotifications(channelName: string): void {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('bookings', {
      name: channelName,
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
}

/**
 * This device's Expo push token, asking for permission only when `ask` is true (after a booking
 * or from Account settings, never on first launch; ADR-022). Null on simulators, without
 * permission, or without an EAS project (Expo push tokens need one).
 */
export async function devicePushToken(ask: boolean): Promise<string | null> {
  if (!Device.isDevice || !appConfig.easProjectId) return null;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== Notifications.PermissionStatus.GRANTED && ask) {
      preferences.set(ASKED_KEY, true);
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== Notifications.PermissionStatus.GRANTED) return null;
    const token = await Notifications.getExpoPushTokenAsync({ projectId: appConfig.easProjectId });
    return token.data;
  } catch {
    return null;
  }
}

export const hasAskedForPush = (): boolean => preferences.getBoolean(ASKED_KEY) === true;

const platform = (): 'ios' | 'android' => (Platform.OS === 'ios' ? 'ios' : 'android');

/** Follows a booking on this device (guests and owners); best effort. */
export async function followBooking(
  api: ApiClient,
  bookingId: string,
  headers: Record<string, string>,
  ask: boolean,
): Promise<boolean> {
  const token = await devicePushToken(ask);
  if (!token) return false;
  const { response } = await api.PUT('/v1/bookings/{bookingId}/push-token', {
    params: { path: { bookingId }, header: headers },
    body: { token, platform: platform() },
  });
  return response.ok;
}

/** Registers the device for the signed-in account (tied to this session). */
export async function followAccount(api: ApiClient, ask: boolean): Promise<boolean> {
  const token = await devicePushToken(ask);
  if (!token) return false;
  const { response } = await api.PUT('/v1/me/push-token', {
    body: { token, platform: platform() },
  });
  return response.ok;
}
