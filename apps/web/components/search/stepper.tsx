'use client';

import { Minus, Plus } from 'lucide-react';

export interface StepperProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  incrementLabel: string;
  decrementLabel: string;
}

const buttonClass =
  'inline-flex size-12 items-center justify-center rounded-pill border border-border-strong text-primary transition-colors duration-fast hover:bg-primary-subtle focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-40';

/** Counter with 44px buttons; the live value is announced politely. */
export function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
  incrementLabel,
  decrementLabel,
}: StepperProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col">
        <span className="font-body text-body font-bold text-foreground">{label}</span>
        {hint ? <span className="font-body text-caption text-muted">{hint}</span> : null}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={buttonClass}
          aria-label={decrementLabel}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          <Minus aria-hidden="true" className="size-4" />
        </button>
        <output
          aria-live="polite"
          className="w-6 text-center font-body text-body font-bold text-foreground"
        >
          {value}
        </output>
        <button
          type="button"
          className={buttonClass}
          aria-label={incrementLabel}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          <Plus aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
