'use client';

import { RadioGroup } from 'radix-ui';
import { useId } from 'react';

import { cn } from '../lib/cn';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name for the group, e.g. "Trip type". */
  label: string;
  /** Form field name of the hidden radio inputs; generated when omitted. */
  name?: string;
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}

/**
 * Pill-style single choice (trip type: round trip / one way / multi-city). A radio group
 * semantically, so arrow keys move the selection.
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
  return (
    <RadioGroup.Root
      aria-label={label}
      name={name ?? generatedName}
      value={value}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option) onValueChange(option.value);
      }}
      orientation="horizontal"
      className={cn(
        'inline-flex max-w-full rounded-pill border border-border bg-background p-1',
        className,
      )}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            'min-h-12 min-w-0 rounded-pill px-3 font-body text-body-sm font-bold text-balance text-muted sm:px-4',
            'transition-colors duration-fast ease-standard hover:text-primary focus-visible:focus-ring',
            'aria-checked:bg-primary aria-checked:text-on-primary aria-checked:hover:text-on-primary',
          )}
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
