'use client';

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const variantClasses = {
  /** Centred modal. */
  modal: [
    'inset-x-4 top-1/2 max-h-screen -translate-y-1/2 rounded-xl',
    'md:inset-x-auto md:left-1/2 md:w-full md:max-w-dialog md:-translate-x-1/2',
  ],
  /** Bottom sheet (mobile pickers). */
  sheet: 'inset-x-0 bottom-0 max-h-screen rounded-t-xl',
  /** Full-screen panel (mobile date picker). */
  fullscreen: 'inset-0',
} as const;

export interface DialogContentProps extends Omit<
  ComponentProps<typeof DialogPrimitive.Content>,
  'title'
> {
  /** Required accessible title (visually hidden with `hideTitle`). */
  title: string;
  hideTitle?: boolean;
  description?: string | undefined;
  /** Accessible label for the close button, e.g. "Close". */
  closeLabel: string;
  variant?: keyof typeof variantClasses;
  footer?: ReactNode;
}

/** Modal, bottom sheet or full-screen dialog. Focus is trapped and restored on close. */
export function DialogContent({
  title,
  hideTitle = false,
  description,
  closeLabel,
  variant = 'modal',
  footer,
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay" />
      <DialogPrimitive.Content
        // Radix warns unless aria-describedby is explicitly undefined when there is no description.
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={cn(
          'fixed z-50 flex flex-col gap-4 overflow-y-auto bg-surface p-6 text-foreground shadow-card-hover focus-visible:focus-ring',
          variantClasses[variant],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <DialogPrimitive.Title
            className={cn('font-heading text-h4 font-bold text-heading', hideTitle && 'sr-only')}
          >
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="-m-2 inline-flex size-12 shrink-0 items-center justify-center rounded-pill text-muted transition-colors duration-fast hover:bg-background hover:text-foreground focus-visible:focus-ring"
          >
            <X aria-hidden="true" className="size-6" />
          </DialogPrimitive.Close>
        </div>
        {description ? (
          <DialogPrimitive.Description className="font-body text-body-sm text-muted">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        <div className="flex-1">{children}</div>
        {footer ? (
          <div className="flex flex-col gap-2 md:flex-row md:justify-end">{footer}</div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
