import { motion } from '@suskii/design-tokens';
import { useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { cn } from '../lib/cn';

export interface SkeletonProps {
  className?: string;
}

// Four base-motion steps per half cycle: a slow, subtle pulse (no shimmer).
const PULSE_MS = motion.duration.base * 4;

/** Loading placeholder; static when the OS asks for reduced motion. Hidden from screen readers. */
export function Skeleton({ className }: SkeletonProps) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!reduceMotion) {
      opacity.value = withRepeat(withTiming(0.5, { duration: PULSE_MS }), -1, true);
    }
  }, [opacity, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn('rounded-md bg-skeleton', className)}
      style={animatedStyle}
    />
  );
}
