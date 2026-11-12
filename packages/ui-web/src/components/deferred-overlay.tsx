'use client';

import { lazy, Suspense, useCallback, useRef, useState, type ComponentProps } from 'react';

const loadPanels = () => import('./overlay-panels');
const PopoverPanel = lazy(() => loadPanels().then((module) => ({ default: module.PopoverPanel })));
const DialogPanel = lazy(() => loadPanels().then((module) => ({ default: module.DialogPanel })));

/** Starts downloading the overlay code ahead of opening (hover or focus on a trigger). */
export function prefetchOverlay(): void {
  loadPanels().catch(() => undefined);
}

export interface DeferredOverlay {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** True once the panel has opened; it then stays mounted so closing can restore focus. */
  mounted: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  /** Spread onto the trigger button: toggling, ARIA state and prefetching. */
  triggerProps: {
    ref: React.RefObject<HTMLButtonElement | null>;
    'aria-haspopup': 'dialog';
    'aria-expanded': boolean;
    onClick: () => void;
    onPointerEnter: () => void;
    onFocus: () => void;
  };
}

/**
 * State for a popover or dialog whose code loads on first use: until then the page only renders
 * the trigger, so Radix and floating-ui are not part of its initial JavaScript.
 */
export function useDeferredOverlay(): DeferredOverlay {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpenState] = useState(false);
  const [mounted, setMounted] = useState(false);
  const setOpen = useCallback((next: boolean) => {
    if (next) setMounted(true);
    setOpenState(next);
  }, []);
  return {
    open,
    setOpen,
    mounted,
    triggerRef,
    triggerProps: {
      ref: triggerRef,
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      onClick: () => setOpen(!open),
      onPointerEnter: prefetchOverlay,
      onFocus: prefetchOverlay,
    },
  };
}

type PanelProps<T> = Omit<T, 'open' | 'onOpenChange' | 'triggerRef'> & { overlay: DeferredOverlay };

export function DeferredPopover({
  overlay,
  ...props
}: PanelProps<ComponentProps<typeof PopoverPanel>>) {
  if (!overlay.mounted) return null;
  return (
    <Suspense fallback={null}>
      <PopoverPanel
        {...props}
        open={overlay.open}
        onOpenChange={overlay.setOpen}
        triggerRef={overlay.triggerRef}
      />
    </Suspense>
  );
}

export function DeferredDialog({
  overlay,
  ...props
}: PanelProps<ComponentProps<typeof DialogPanel>>) {
  if (!overlay.mounted) return null;
  return (
    <Suspense fallback={null}>
      <DialogPanel
        {...props}
        open={overlay.open}
        onOpenChange={overlay.setOpen}
        triggerRef={overlay.triggerRef}
      />
    </Suspense>
  );
}
