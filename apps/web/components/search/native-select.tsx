'use client';

import { cn } from '@suskii/ui-web';
import type { ComponentProps } from 'react';

export interface NativeSelectProps extends ComponentProps<'select'> {
  label: string;
  options: readonly { value: string; label: string }[];
  error?: string | undefined;
}

/** Labelled native select: accessible everywhere and zero JavaScript on phones. */
export function NativeSelect({
  label,
  options,
  error,
  id,
  className,
  ...props
}: NativeSelectProps) {
  const errorId = error && id ? `${id}-error` : undefined;
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="font-body text-body-sm font-medium text-foreground">{label}</span>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={cn(
          'h-12 w-full rounded-md border border-border-strong bg-surface px-3 font-body text-body text-foreground focus-visible:focus-ring',
          error && 'border-danger',
        )}
        {...props}
      >
        {options.map((option) => (
          // Labels are often Intl-formatted (months, prices), and Node and the browser can ship
          // different CLDR data: keep the server's text instead of failing hydration.
          <option key={option.value} value={option.value} suppressHydrationWarning>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span id={errorId} className="font-body text-caption text-danger">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function CheckboxField({
  label,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type' | 'name'> & { label: string; name: string }) {
  return (
    <label
      className={cn(
        'flex min-h-12 items-center gap-3 font-body text-body-sm text-foreground',
        className,
      )}
    >
      <input type="checkbox" className="size-5 shrink-0 accent-primary" {...props} />
      {label}
    </label>
  );
}
