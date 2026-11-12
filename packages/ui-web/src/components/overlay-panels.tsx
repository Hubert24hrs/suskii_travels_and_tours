'use client';

import { Dialog as DialogPrimitive, Popover as PopoverPrimitive } from 'radix-ui';
import type { ReactNode, RefObject } from 'react';

import { DialogContent, type DialogContentProps } from './dialog';
import { PopoverContent } from './popover';

interface PanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The button that opens the panel: anchors the popover and gets focus back on close. */
  triggerRef: RefObject<HTMLElement | null>;
  /** The content focuses itself (DayPicker focuses the selected day or today). */
  skipAutoFocus?: boolean;
  children: ReactNode;
}

const autoFocus = (skip: boolean | undefined) =>
  skip ? { onOpenAutoFocus: (event: Event) => event.preventDefault() } : {};

/**
 * Popover anchored to an external trigger. Loaded on demand by useDeferredOverlay, so Radix and
 * floating-ui stay out of the initial JavaScript of pages that merely show a picker.
 */
export function PopoverPanel({
  open,
  onOpenChange,
  triggerRef,
  skipAutoFocus,
  label,
  className,
  children,
}: PanelProps & { label: string; className?: string }) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Anchor virtualRef={triggerRef} />
      <PopoverContent
        aria-label={label}
        className={className}
        {...autoFocus(skipAutoFocus)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
        // The trigger toggles the panel itself; pressing it is not an outside click.
        onPointerDownOutside={(event) => {
          if (triggerRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        {children}
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}

/** Modal, sheet or full-screen dialog opened by an external trigger (see PopoverPanel). */
export function DialogPanel({
  open,
  onOpenChange,
  triggerRef,
  skipAutoFocus,
  children,
  ...content
}: PanelProps & Omit<DialogContentProps, 'children'>) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent
        {...content}
        {...autoFocus(skipAutoFocus)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        {children}
      </DialogContent>
    </DialogPrimitive.Root>
  );
}
