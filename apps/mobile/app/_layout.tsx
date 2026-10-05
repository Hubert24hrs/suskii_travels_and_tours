import '../global.css';

import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import {
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { getMessages } from '@suskii/i18n';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { openSecureCache } from '../src/lib/cache';
import { resolveNotificationPath } from '../src/lib/deep-links';
import { configureNotifications } from '../src/lib/push';
import type { SessionStore } from '../src/lib/session';
import { AppProvider, createSessionStore, deviceLocale, useT } from '../src/providers/app-provider';

/** Opens the encrypted cache and restores the session before the first screen renders. */
function useBootstrap(): SessionStore | null {
  const [session, setSession] = useState<SessionStore | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await openSecureCache();
      const store = createSessionStore();
      await store.load();
      if (!cancelled) setSession(store);
    })();
    configureNotifications(getMessages(deviceLocale()).mobile.notificationChannel);
    return () => {
      cancelled = true;
    };
  }, []);
  return session;
}

/** A tapped notification opens its trip; only validated trip paths are followed (ADR-022). */
function useNotificationTaps(): void {
  const router = useRouter();
  useEffect(() => {
    const open = (data: unknown) => {
      const path = resolveNotificationPath((data as { path?: unknown } | undefined)?.path);
      if (path) router.push(path);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification.request.content.data);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
      open(response.notification.request.content.data),
    );
    return () => subscription.remove();
  }, [router]);
}

function Screens() {
  const { t } = useT();
  useNotificationTaps();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerTitleAlign: 'center' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="search/flights" options={{ title: t('mobile.search.titles.flights') }} />
      <Stack.Screen name="search/hotels" options={{ title: t('mobile.search.titles.hotels') }} />
      <Stack.Screen name="hotels/[hotelId]" options={{ title: '' }} />
      <Stack.Screen name="checkout/[quoteId]" options={{ title: t('mobile.checkout.title') }} />
      <Stack.Screen name="trips/[id]/index" options={{ title: '' }} />
      <Stack.Screen
        name="trips/[id]/visa/[applicationId]"
        options={{ title: t('mobile.visa.title') }}
      />
      <Stack.Screen name="trips/[id]/addons" options={{ title: t('mobile.addons.title') }} />
      <Stack.Screen name="packages/index" options={{ title: t('mobile.search.titles.packages') }} />
      <Stack.Screen name="packages/[slug]" options={{ title: '' }} />
      <Stack.Screen name="tours/index" options={{ title: t('mobile.search.titles.tours') }} />
      <Stack.Screen name="tours/[slug]" options={{ title: '' }} />
      <Stack.Screen
        name="sign-in"
        options={{ presentation: 'modal', title: t('mobile.auth.signInTitle') }}
      />
      <Stack.Screen
        name="register"
        options={{ presentation: 'modal', title: t('mobile.auth.registerTitle') }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  // Family names must match @suskii/design-tokens fontFamily.native.
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });
  const session = useBootstrap();

  // Custom font families are unknown to iOS until loaded, so render nothing until then.
  if (!fontsLoaded || !session) return null;

  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <AppProvider session={session}>
          <BottomSheetModalProvider>
            <StatusBar style="dark" />
            <Screens />
          </BottomSheetModalProvider>
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
