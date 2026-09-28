'use client';

import { useId, type ComponentProps, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  /** Visible label (required for accessibility). */
  label: string;
  /** Keeps the label for screen readers but hides it visually. */
  hideLabel?: boolean;
  /** Help text under the field. */
  hint?: string | undefined;
  /** Error message; marks the field invalid and is announced. */
  error?: string | undefined;
  /** Decorative icon shown inside the field on the left. */
  icon?: ReactNode;
}

export const inputClasses = cn(
  'h-12 w-full rounded-md border border-border-strong bg-surface px-4 font-body text-body text-foreground',
  'placeholder:text-muted transition-colors duration-fast ease-standard hover:border-primary',
  'focus-visible:focus-ring aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-background',
);

export function Input({
  label,
  hideLabel = false,
  hint,
  error,
  icon,
  id,
  className,
  ...props
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={inputId}
        className={cn('font-body text-body-sm font-medium text-foreground', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <div className="relative">
        {icon ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-muted"
          >
            {icon}
          </span>
        ) : null}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(inputClasses, icon ? 'pl-12' : undefined, className)}
          {...props}
        />
      </div>
      {hint ? (
        <p id={hintId} className="font-body text-caption text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="font-body text-caption text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
