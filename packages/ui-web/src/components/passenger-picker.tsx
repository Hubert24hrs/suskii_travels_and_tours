'use client';

import {
  TRAVELLER_TYPES,
  canDecrement,
  canIncrement,
  stepTravellers,
  type TravellerCounts,
  type TravellerType,
} from '@suskii/shared';
import { Minus, Plus, Users } from 'lucide-react';
import { useId, useState } from 'react';

import { useIsDesktop } from '../lib/use-media-query';

import { Button } from './button';
import { Dialog, DialogContent, DialogTrigger } from './dialog';
import { FieldButton, FieldLabel } from './field-trigger';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './popover';

export interface PassengerPickerLabels {
  /** Row title and age band, e.g. { title: "Children", description: "Ages 2-11" }. */
  types: Record<TravellerType, { title: string; description: string }>;
  /** Accessible names for the steppers, e.g. { adults: "Add an adult" }. */
  increment: Record<TravellerType, string>;
  decrement: Record<TravellerType, string>;
  done: string;
  close: string;
}

export interface PassengerPickerProps {
  /** Field label, e.g. "Travellers". */
  label: string;
  /** Localised summary of the value, e.g. "2 adults, 1 infant". */
  summary: string;
  value: TravellerCounts;
  onChange: (value: TravellerCounts) => void;
  labels: PassengerPickerLabels;
  /** Validation message; marks the field invalid and is announced with it. */
  error?: string | undefined;
  /** Id of the trigger button (for focusing the first invalid field). */
  id?: string;
  className?: string;
}

const stepButtonClasses =
  'inline-flex size-12 items-center justify-center rounded-pill border border-border-strong text-primary transition-colors duration-fast hover:bg-primary-subtle focus-visible:focus-ring disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:hover:bg-transparent';

function TravellerSteppers({
  value,
  onChange,
  labels,
}: Pick<PassengerPickerProps, 'value' | 'onChange' | 'labels'>) {
  const baseId = useId();
  return (
    <div className="flex flex-col divide-y divide-border">
      {TRAVELLER_TYPES.map((type) => {
        const titleId = `${baseId}-${type}`;
        return (
          <div key={type} className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col">
              <span id={titleId} className="font-body text-body font-bold text-foreground">
                {labels.types[type].title}
              </span>
              <span className="font-body text-body-sm text-muted">
                {labels.types[type].description}
              </span>
            </div>
            <div role="group" aria-labelledby={titleId} className="flex items-center gap-3">
              <button
                type="button"
                aria-label={labels.decrement[type]}
                disabled={!canDecrement(value, type)}
                onClick={() => onChange(stepTravellers(value, type, -1))}
                className={stepButtonClasses}
              >
                <Minus aria-hidden="true" className="size-5" />
              </button>
              <output
                aria-live="polite"
                className="w-6 text-center font-body text-body font-bold text-foreground"
              >
                {value[type]}
              </output>
              <button
                type="button"
                aria-label={labels.increment[type]}
                disabled={!canIncrement(value, type)}
                onClick={() => onChange(stepTravellers(value, type, 1))}
                className={stepButtonClasses}
              >
                <Plus aria-hidden="true" className="size-5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Adults / children / infants steppers enforcing the shared traveller rules (infants <= adults,
 * total <= 9). A popover on desktop and a bottom sheet on mobile.
 */
export function PassengerPicker({
  label,
  summary,
  value,
  onChange,
  labels,
  error,
  id,
  className,
}: PassengerPickerProps) {
  const labelId = useId();
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const errorId = error ? `${labelId}-error` : undefined;
  const trigger = (
    <FieldButton
      id={id}
      labelId={labelId}
      value={summary}
      icon={<Users className="size-5" />}
      aria-invalid={error ? true : undefined}
      aria-describedby={errorId}
      className={error ? 'border-danger' : undefined}
    />
  );
  const steppers = <TravellerSteppers value={value} onChange={onChange} labels={labels} />;

  return (
    <div className={className}>
      <div className="flex flex-col gap-1">
        <FieldLabel id={labelId}>{label}</FieldLabel>
        {isDesktop ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent aria-label={label} className="w-full max-w-popover">
              {steppers}
              <PopoverClose asChild>
                <Button fullWidth className="mt-2">
                  {labels.done}
                </Button>
              </PopoverClose>
            </PopoverContent>
          </Popover>
        ) : (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent
              title={label}
              closeLabel={labels.close}
              variant="sheet"
              footer={
                <Button fullWidth onClick={() => setOpen(false)}>
                  {labels.done}
                </Button>
              }
            >
              {steppers}
            </DialogContent>
          </Dialog>
        )}
        {error ? (
          <p id={errorId} className="font-body text-caption text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
