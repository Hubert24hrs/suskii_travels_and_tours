import type { ReactNode } from 'react';
import { Pressable, View, type AccessibilityRole } from 'react-native';

import { cn } from '../lib/cn';

export interface CardProps {
  children: ReactNode;
  /** Makes the whole card pressable. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  flat?: boolean;
  className?: string;
  /** Stable id for tests and Maestro flows. */
  testID?: string;
}

export function Card({
  children,
  onPress,
  accessibilityLabel,
  accessibilityRole,
  flat = false,
  className,
  testID,
}: CardProps) {
  const classes = cn(
    'rounded-lg border bg-surface',
    flat ? 'border-transparent' : 'border-border',
    className,
  );
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole={accessibilityRole ?? 'button'}
        accessibilityLabel={accessibilityLabel}
        className={cn(classes, 'active:opacity-80')}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      className={classes}
    >
      {children}
    </View>
  );
}
