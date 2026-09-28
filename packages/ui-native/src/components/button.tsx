import { color } from '@suskii/design-tokens';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, type PressableProps } from 'react-native';

import { cn } from '../lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost';

const containerClasses: Record<Variant, string> = {
  primary: 'bg-primary shadow-primary-button active:bg-primary-pressed',
  // Orange takes dark text: white on the brand orange fails WCAG at every size (ADR-004).
  secondary: 'bg-accent active:bg-accent-hover',
  ghost: 'bg-transparent active:bg-primary-subtle',
};

const labelClasses: Record<Variant, string> = {
  primary: 'text-on-primary',
  secondary: 'text-on-accent',
  ghost: 'text-primary',
};

const spinnerColor: Record<Variant, string> = {
  primary: color['on-primary'],
  secondary: color['on-accent'],
  ghost: color.primary,
};

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  /** Visible label; also the accessible name. */
  children: string;
  variant?: Variant;
  /** Shows a spinner, disables the button and marks it busy for screen readers. */
  loading?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
  className?: string;
}

export function Button({
  children,
  variant = 'primary',
  loading = false,
  disabled,
  fullWidth = false,
  icon,
  className,
  ...props
}: ButtonProps) {
  const isDisabled = disabled === true || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      className={cn(
        'min-h-12 flex-row items-center justify-center gap-2 rounded-lg px-6',
        containerClasses[variant],
        fullWidth && 'w-full',
        isDisabled && 'opacity-60',
        className,
      )}
      {...props}
    >
      {loading ? <ActivityIndicator size="small" color={spinnerColor[variant]} /> : icon}
      <Text className={cn('font-body-bold text-body', labelClasses[variant])}>{children}</Text>
    </Pressable>
  );
}
