import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/**
 * Loading placeholder with a subtle pulse (no shimmer), static under reduced motion.
 * Size it with token utilities, e.g. `className="h-4 w-full"`. Hidden from assistive tech;
 * announce loading on the container instead (`aria-busy`).
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-skeleton motion-reduce:animate-none', className)}
      {...props}
    />
  );
}
