import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export const buttonVariants = cva(
  [
    'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-6 font-body text-body font-bold',
    'transition-colors duration-fast ease-standard focus-visible:focus-ring',
    'disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-on-primary shadow-primary-button hover:bg-primary-hover active:bg-primary-pressed',
        // Orange takes dark text: white on the brand orange fails WCAG at every size (ADR-004).
        secondary: 'bg-accent text-on-accent hover:bg-accent-hover',
        ghost: 'bg-transparent text-primary hover:bg-primary-subtle',
      },
      fullWidth: {
        true: 'w-full',
        mobile: 'w-full md:w-auto',
        false: '',
      },
    },
    defaultVariants: { variant: 'primary', fullWidth: false },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the single child element (e.g. a link) with button styling instead of a `<button>`. */
  asChild?: boolean;
  /** Shows a spinner, disables the button and sets `aria-busy`. Ignored with `asChild`. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  fullWidth,
  asChild = false,
  loading = false,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, fullWidth }), className);
  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <LoaderCircle
          aria-hidden="true"
          className="size-5 animate-spin motion-reduce:animate-none"
        />
      ) : null}
      {children}
    </button>
  );
}
