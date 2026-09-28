import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { cn } from '../lib/cn';

export interface FieldButtonProps {
  label: string;
  value?: string | undefined;
  placeholder?: string | undefined;
  icon?: ReactNode;
  onPress: () => void;
  className?: string;
}

/** Pressable styled as a form field that opens a picker. Announces label and value together. */
export function FieldButton({
  label,
  value,
  placeholder,
  icon,
  onPress,
  className,
}: FieldButtonProps) {
  return (
    <View className={cn('gap-1', className)}>
      <Text
        importantForAccessibility="no"
        accessibilityElementsHidden
        className="font-body-medium text-body-sm text-foreground"
      >
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value ?? placeholder ?? ''}`}
        onPress={onPress}
        className="h-12 flex-row items-center gap-3 rounded-md border border-border-strong bg-surface px-4 active:border-primary"
      >
        {icon}
        <Text
          numberOfLines={1}
          className={cn('flex-1 font-body text-body', value ? 'text-foreground' : 'text-muted')}
        >
          {value ?? placeholder}
        </Text>
      </Pressable>
    </View>
  );
}
