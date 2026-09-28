import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { cn } from '../lib/cn';

export interface TrustBarItem {
  id: string;
  label: string;
  icon: ReactNode;
}

export interface TrustBarProps {
  label: string;
  /** Verified CMS trust signals only (brand guardrails). */
  items: readonly TrustBarItem[];
  className?: string;
}

/** 2x2 grid of icon + label. */
export function TrustBar({ label, items, className }: TrustBarProps) {
  if (items.length === 0) return null;
  return (
    <View role="list" accessibilityLabel={label} className={cn('flex-row flex-wrap', className)}>
      {items.map((item) => (
        <View key={item.id} role="listitem" className="w-1/2 flex-row items-center gap-2 py-2 pr-2">
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {item.icon}
          </View>
          <Text className="flex-1 font-body-medium text-body-sm text-foreground">{item.label}</Text>
        </View>
      ))}
    </View>
  );
}
