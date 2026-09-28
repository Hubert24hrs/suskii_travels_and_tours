'use client';

import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface FieldButtonProps extends Omit<ComponentProps<'button'>, 'value' | 'children'> {
  /** Id of the element holding the visible field label. */
  labelId: string;
  /** Current value; `placeholder` is shown when empty. */
  value?: string | undefined;
  placeholder?: string | undefined;
  icon?: ReactNode;
}

/**
 * Button styled as a form field, used to open pickers (dates, travellers). Its accessible name
 * combines the field label and the current value, so screen readers announce both. Accepts a
 * ref and arbitrary props so it can be a Radix `asChild` trigger.
 */
export function FieldButton({
  labelId,
  value,
  placeholder,
  icon,
  className,
  id,
  ...props
}: FieldButtonProps) {
  const valueId = `${id ?? labelId}-value`;
  return (
    <button
      id={id}
      type="button"
      aria-labelledby={`${labelId} ${valueId}`}
      className={cn(
        'flex h-12 w-full items-center gap-3 rounded-md border border-border-strong bg-surface px-4 text-left font-body text-body text-foreground',
        'transition-colors duration-fast ease-standard hover:border-primary focus-visible:focus-ring',
        className,
      )}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="flex shrink-0 text-muted">
          {icon}
        </span>
      ) : null}
      <span id={valueId} className={cn('truncate', !value && 'text-muted')}>
        {value ?? placeholder}
      </span>
    </button>
  );
}

export function FieldLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span id={id} className="font-body text-body-sm font-medium text-foreground">
      {children}
    </span>
  );
}
