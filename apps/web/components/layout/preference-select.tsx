'use client';

import { cn } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export interface PreferenceSelectProps {
  /** Server action that stores the preference cookie. */
  action: (formData: FormData) => Promise<void>;
  name: 'currency' | 'locale';
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  /** Label of the submit button shown when JavaScript is unavailable. */
  submitLabel: string;
  className?: string;
}

/**
 * Currency or locale selector. Changing it submits the server action and refreshes the page so
 * server-rendered prices and dates update; without JavaScript the form still works via the button.
 */
export function PreferenceSelect({
  action,
  name,
  label,
  value,
  options,
  submitLabel,
  className,
}: PreferenceSelectProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={action}
      className={cn('flex items-center gap-2', className)}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          await action(data);
          router.refresh();
        });
      }}
    >
      <label className="flex items-center gap-2 font-body text-body-sm text-foreground">
        <span>{label}</span>
        <select
          name={name}
          defaultValue={value}
          disabled={pending}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="min-h-12 rounded-md border border-border-strong bg-surface px-3 font-body text-body-sm text-foreground focus-visible:focus-ring"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <noscript>
        <button
          type="submit"
          className="min-h-12 px-2 font-body text-body-sm font-bold text-primary"
        >
          {submitLabel}
        </button>
      </noscript>
    </form>
  );
}
