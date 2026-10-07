'use client';

import { useId } from 'react';

import { cn } from '../lib/cn';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name for the group, e.g. "Trip type". */
  label: string;
  /** Form field name of the radio inputs; generated when omitted. */
  name?: string;
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}

/**
 * Pill-style single choice (trip type: round trip / one way / multi-city). Native radio inputs,
 * so arrow keys move the selection and it works before hydration; each input covers its pill and
 * is transparent, the label text sits on top.
 */
export function SegmentedControl<T extends string>({
  label,
  name,
  options,
  value,
  onValueChange,
  className,
}: SegmentedControlProps<T>) {
  const generatedName = useId();
  const groupName = name ?? generatedName;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex max-w-full rounded-pill border border-border bg-background p-1',
        className,
      )}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'relative inline-flex min-h-12 min-w-0 items-center justify-center rounded-pill px-3 font-body text-body-sm font-bold text-balance text-muted sm:px-4',
            'transition-colors duration-fast ease-standard hover:text-primary',
            'has-checked:bg-primary has-checked:text-on-primary has-checked:hover:text-on-primary',
          )}
        >
          <input
            type="radio"
            name={groupName}
            value={option.value}
            checked={option.value === value}
            onChange={() => onValueChange(option.value)}
            className="absolute inset-0 cursor-pointer appearance-none rounded-pill focus-visible:focus-ring"
          />
          <span className="pointer-events-none relative">{option.label}</span>
        </label>
      ))}
    </div>
  );
}
