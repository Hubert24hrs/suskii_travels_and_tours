import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export interface FilterChipProps extends Omit<ComponentProps<'button'>, 'type'> {
  /** Whether the filter is active; exposed to assistive technology as `aria-pressed`. */
  selected: boolean;
}

/** Toggle chip for result filters (for example the deals origin city). 44px touch target. */
export function FilterChip({ selected, className, ...props }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center rounded-pill border px-4 font-body text-body-sm font-bold',
        'transition-colors duration-fast ease-standard focus-visible:focus-ring',
        selected
          ? 'border-primary bg-primary text-on-primary'
          : 'border-border-strong bg-surface text-foreground hover:border-primary hover:text-primary',
        className,
      )}
      {...props}
    />
  );
}
