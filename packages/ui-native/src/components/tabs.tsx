import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';

import { cn } from '../lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface TabsProps<T extends string> {
  /** Accessible name for the tab list, e.g. "Search categories". */
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}

/** Horizontally scrollable tab pills with the spec's 3px active underline. */
export function Tabs<T extends string>({
  label,
  items,
  value,
  onValueChange,
  className,
}: TabsProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel={label}
      className={cn('flex-grow-0 border-b border-border', className)}
      contentContainerClassName="gap-2"
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onValueChange(item.value)}
            className={cn(
              'min-h-12 flex-row items-center gap-2 border-b-3 px-4',
              selected ? 'border-primary' : 'border-transparent',
            )}
          >
            {item.icon}
            <Text
              className={cn(
                'font-body-bold text-body-sm',
                selected ? 'text-primary' : 'text-muted',
              )}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
