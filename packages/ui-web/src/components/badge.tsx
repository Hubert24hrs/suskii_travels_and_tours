import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-pill px-2 py-1 font-body text-caption font-bold',
  {
    variants: {
      variant: {
        /** Savings and promotions. */
        promo: 'bg-accent text-on-accent',
        info: 'bg-primary-subtle text-primary',
        /** e.g. "Free cancellation". */
        success: 'bg-success text-on-status',
        warning: 'bg-warning text-on-status',
        danger: 'bg-danger text-on-status',
        neutral: 'border border-border bg-background text-foreground',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
