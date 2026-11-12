import { spacing } from '@suskii/design-tokens';
import { iconColor, iconSize } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import { Bot, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  I18nManager,
  Keyboard,
  PanResponder,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { askSuskii, useAskSuskiiAway } from '../../lib/ask-suskii';
import { useApp, useT } from '../../providers/app-provider';

/**
 * Screens that never show the button: the assistant itself, sign-in, anything that takes a
 * payment or shows a ticket or a document (those screens are also kept out of screenshots),
 * a live ride, staff screens, and the support chat, whose message box sits where it would.
 */
const HIDDEN: readonly RegExp[] = [
  /^\/assistant(\/|$)/,
  /^\/checkout(\/|$)/,
  /^\/sign-in(\/|$)/,
  /^\/register(\/|$)/,
  /^\/trips\/./,
  /^\/rides\/./,
  /^\/account\/./,
  /^\/support(\/|$)/,
  /^\/driver(\/|$)/,
  /^\/operator(\/|$)/,
];

/** Whether a screen shows the "Ask Suskii" button. */
export const showsAskSuskii = (pathname: string): boolean =>
  !HIDDEN.some((pattern) => pattern.test(pathname));

/** The places the button rests in: the two lower corners and half way up each side. */
export const ASK_SUSKII_PLACES = 4;

/** The next place: never the one it is in, so a move is always seen. */
export const nextPlace = (current: number, random: () => number = Math.random): number =>
  (current + 1 + Math.floor(random() * (ASK_SUSKII_PLACES - 1))) % ASK_SUSKII_PLACES;

/** How long the button rests before it moves on, and how long a move takes. */
export const ASK_SUSKII_REST_MS = 15_000;
const GLIDE_MS = 600;
/** A finger that travels less than this pressed the button; further, it is moving it. */
const DRAG_THRESHOLD = spacing['2'];
const EDGE = spacing['4'];
/** Room kept under the button for the tab bar and a screen's own bottom bar. */
const LIFT = spacing['20'] + spacing['4'];
/** Its size before the first layout pass has measured it. */
const FIRST_GUESS = { width: spacing['20'] * 2, height: spacing['12'] };

interface Point {
  x: number;
  y: number;
}

/**
 * "Ask Suskii" in the app (ADR-109): the one way into the assistant, a button that floats over
 * the screens and does not stay put. It takes a new place each time the traveller opens another
 * screen and moves on every few seconds; a finger can drag it anywhere, where it then stays
 * until the next screen, and its small cross puts it away until the app starts again (Account
 * offers the assistant meanwhile).
 *
 * It shows only while the API says the assistant is available (ADR-101): an answer the app
 * cannot read shows nothing, and no search or booking screen waits for it. With "reduce motion"
 * or a screen reader on, it changes place between screens only and never glides.
 */
export function AskSuskiiButton() {
  const { api } = useApp();
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const status = useQuery({
    queryKey: ['agent', 'status'],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => (await api.GET('/v1/agent/status')).data ?? null,
  });

  const [size, setSize] = useState<{ width: number; height: number }>(FIRST_GUESS);
  const [place, setPlace] = useState(() => Math.floor(Math.random() * ASK_SUSKII_PLACES));
  const [still, setStill] = useState(false);
  const [typing, setTyping] = useState(false);
  const putAway = useAskSuskiiAway();
  /** Where a finger left it; cleared when the traveller opens another screen. */
  const [parked, setParked] = useState<Point | null>(null);

  const places = useMemo((): Point[] => {
    const right = window.width - size.width - EDGE;
    const bottom = window.height - size.height - insets.bottom - LIFT;
    const middle = Math.round(window.height * 0.45);
    // The corner on the side where the language ends comes first, as on the website.
    const [end, start] = I18nManager.isRTL ? [EDGE, right] : [right, EDGE];
    return [
      { x: end, y: bottom },
      { x: end, y: middle },
      { x: start, y: middle },
      { x: start, y: bottom },
    ];
  }, [window.width, window.height, size.width, size.height, insets.bottom]);

  // Another screen: another place, and a place a finger chose no longer holds.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setParked(null);
    setPlace(nextPlace(place));
  }

  const { x, y } = parked ?? places[place] ?? { x: EDGE, y: EDGE };
  const [position] = useState(() => new Animated.ValueXY({ x, y }));
  const shown = status.data?.available === true && !putAway && !typing && showsAskSuskii(pathname);

  // Reduced motion or a screen reader: it holds still between screens.
  useEffect(() => {
    let active = true;
    const read = () =>
      void Promise.all([
        AccessibilityInfo.isReduceMotionEnabled(),
        AccessibilityInfo.isScreenReaderEnabled(),
      ]).then(([reduced, reader]) => {
        if (active) setStill(reduced || reader);
      });
    read();
    const subscriptions = [
      AccessibilityInfo.addEventListener('reduceMotionChanged', read),
      AccessibilityInfo.addEventListener('screenReaderChanged', read),
    ];
    return () => {
      active = false;
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);

  // The keyboard takes the lower half of the screen: the button steps aside while it is up.
  useEffect(() => {
    const subscriptions = [
      Keyboard.addListener('keyboardDidShow', () => setTyping(true)),
      Keyboard.addListener('keyboardDidHide', () => setTyping(false)),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);

  // Every few seconds it moves on, unless it was asked to hold still or a finger placed it.
  useEffect(() => {
    if (!shown || still || parked) return;
    const timer = setInterval(
      () => setPlace((current) => (current + 1) % ASK_SUSKII_PLACES),
      ASK_SUSKII_REST_MS,
    );
    return () => clearInterval(timer);
  }, [shown, still, parked]);

  // Glide to where it belongs now; without motion it is simply there.
  useEffect(() => {
    if (still || !shown) {
      position.setValue({ x, y });
      return;
    }
    const glide = Animated.timing(position, {
      toValue: { x, y },
      duration: GLIDE_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    });
    glide.start();
    return () => glide.stop();
  }, [position, x, y, still, shown]);

  const drag = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > DRAG_THRESHOLD || Math.abs(gesture.dy) > DRAG_THRESHOLD,
        // From here the finger's travel is added to where the button was.
        onPanResponderGrant: () => {
          position.stopAnimation();
          position.extractOffset();
        },
        onPanResponderMove: (_event, gesture) => {
          position.setValue({ x: gesture.dx, y: gesture.dy });
        },
        onPanResponderRelease: () => {
          position.flattenOffset();
          // It comes to rest against the nearer side, inside the screen.
          position.stopAnimation((left) => {
            setParked({
              x:
                left.x + size.width / 2 < window.width / 2
                  ? EDGE
                  : window.width - size.width - EDGE,
              y: Math.min(
                Math.max(left.y, insets.top + EDGE),
                window.height - size.height - insets.bottom - EDGE,
              ),
            });
          });
        },
      }),
    [position, window.width, window.height, size.width, size.height, insets.top, insets.bottom],
  );

  if (!shown) return null;
  return (
    // Laid out left to right whatever the language: the places are measured from the left.
    <View pointerEvents="box-none" className="absolute inset-0" style={{ direction: 'ltr' }}>
      <Animated.View
        testID={`ask-suskii-at-${parked ? 'parked' : place}`}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width !== size.width || height !== size.height) setSize({ width, height });
        }}
        // As wide as its content, and moved by a transform only: nothing else is laid out again.
        style={{ alignSelf: 'flex-start', transform: position.getTranslateTransform() }}
        {...drag.panHandlers}
      >
        <View className="flex-row items-center rounded-pill bg-primary shadow-primary-button">
          <Pressable
            testID="ask-suskii"
            accessibilityRole="button"
            accessibilityLabel={t('assistant.open')}
            accessibilityHint={t('assistant.dragHint')}
            onPress={() => router.push('/assistant')}
            className="min-h-12 flex-row items-center gap-2 ps-4 pe-2 active:opacity-80"
          >
            <Bot color={iconColor['on-primary']} size={iconSize.lg} />
            <Text className="font-body-bold text-body text-on-primary">{t('assistant.open')}</Text>
          </Pressable>
          <Pressable
            testID="ask-suskii-hide"
            accessibilityRole="button"
            accessibilityLabel={t('assistant.hide')}
            onPress={() => askSuskii.putAway()}
            hitSlop={spacing['2']}
            className="me-2 size-8 items-center justify-center rounded-pill active:opacity-80"
          >
            <X color={iconColor['on-primary']} size={iconSize.sm} />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}
