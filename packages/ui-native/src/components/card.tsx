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
}

export function Card({
  children,
  onPress,
  accessibilityLabel,
  accessibilityRole,
  flat = false,
  className,
}: CardProps) {
  const classes = cn(
    'rounded-lg border bg-surface',
    flat ? 'border-transparent' : 'border-border',
    className,
  );
  if (onPress) {
    return (
      <Pressable
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
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      className={classes}
    >
      {children}
    </View>
  );
}
