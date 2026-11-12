import { color } from '@suskii/design-tokens';
import { useState, type ReactNode } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { cn } from '../lib/cn';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  /** Visible label; also the field's accessible name. */
  label: string;
  hint?: string | undefined;
  /** Error message; announced and shown under the field. */
  error?: string | undefined;
  icon?: ReactNode;
  className?: string;
}

export function Input({
  label,
  hint,
  error,
  icon,
  className,
  onFocus,
  onBlur,
  ...props
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const description = [error, hint].filter(Boolean).join('. ') || undefined;
  return (
    <View className={cn('gap-1', className)}>
      <Text className="font-body-medium text-body-sm text-foreground">{label}</Text>
      <View
        className={cn(
          'h-12 flex-row items-center gap-3 rounded-md bg-surface px-4',
          error
            ? 'border-2 border-danger'
            : focused
              ? 'border-2 border-focus'
              : 'border border-border-strong',
        )}
      >
        {icon ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {icon}
          </View>
        ) : null}
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={description}
          placeholderTextColor={color.muted}
          className="flex-1 py-0 font-body text-body text-foreground"
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...props}
        />
      </View>
      {hint ? <Text className="font-body text-caption text-muted">{hint}</Text> : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" className="font-body text-caption text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
