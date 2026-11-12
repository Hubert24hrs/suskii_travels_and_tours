import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export interface CardProps extends ComponentProps<'div'> {
  /** Lifts with the card-hover shadow on pointer hover (desktop only). */
  interactive?: boolean;
  /** Drops the outline for cards sitting on a contrasting surface. */
  flat?: boolean;
  /** Render the child element (e.g. `<article>` or a link) with card styling. */
  asChild?: boolean;
}

export function Card({
  className,
  interactive = false,
  flat = false,
  asChild = false,
  ...props
}: CardProps) {
  const Component = asChild ? Slot.Root : 'div';
  return (
    <Component
      className={cn(
        'rounded-lg border bg-surface',
        flat ? 'border-transparent' : 'border-border',
        interactive && 'transition-shadow duration-base ease-standard md:hover:shadow-card-hover',
        className,
      )}
      {...props}
    />
  );
}
