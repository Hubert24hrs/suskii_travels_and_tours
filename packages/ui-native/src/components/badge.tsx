import { Text, View } from 'react-native';

import { cn } from '../lib/cn';

type Variant = 'promo' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const variantClasses: Record<Variant, { container: string; label: string }> = {
  promo: { container: 'bg-accent', label: 'text-on-accent' },
  info: { container: 'bg-primary-subtle', label: 'text-primary' },
  success: { container: 'bg-success', label: 'text-on-status' },
  warning: { container: 'bg-warning', label: 'text-on-status' },
  danger: { container: 'bg-danger', label: 'text-on-status' },
  neutral: { container: 'border border-border bg-background', label: 'text-foreground' },
};

export interface BadgeProps {
  children: string;
  variant?: Variant;
  className?: string;
}

export function Badge({ children, variant = 'info', className }: BadgeProps) {
  return (
    <View
      className={cn(
        'self-start rounded-pill px-2 py-1',
        variantClasses[variant].container,
        className,
      )}
    >
      <Text className={cn('font-body-bold text-caption', variantClasses[variant].label)}>
        {children}
      </Text>
    </View>
  );
}
