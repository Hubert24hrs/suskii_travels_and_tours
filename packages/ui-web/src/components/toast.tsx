'use client';

import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { Toast as ToastPrimitive } from 'radix-ui';
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export type ToastVariant = 'info' | 'success' | 'error';

export interface ToastOptions {
  title: string;
  description?: string | undefined;
  variant?: ToastVariant;
  /** Milliseconds before auto-dismiss. */
  duration?: number;
}

interface ToastEntry extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const icons: Record<ToastVariant, ReactNode> = {
  info: <Info aria-hidden="true" className="size-5 text-primary" />,
  success: <CircleCheck aria-hidden="true" className="size-5 text-success" />,
  error: <CircleAlert aria-hidden="true" className="size-5 text-danger" />,
};

export interface ToastProviderProps {
  children: ReactNode;
  /** Name of the notifications region, e.g. "Notifications". */
  label: string;
  /** Accessible label for each toast's close button, e.g. "Dismiss". */
  closeLabel: string;
  duration?: number;
}

/**
 * Renders toasts in a polite live region (errors are announced assertively). Use `useToast()`
 * anywhere below the provider.
 */
export function ToastProvider({
  children,
  label,
  closeLabel,
  duration = 5000,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

  const toast = useCallback((options: ToastOptions) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => [...current, { ...options, id }]);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastPrimitive.Provider label={label} duration={duration}>
      <ToastContext value={value}>{children}</ToastContext>
      {toasts.map((entry) => {
        const variant = entry.variant ?? 'info';
        return (
          <ToastPrimitive.Root
            key={entry.id}
            type={variant === 'error' ? 'foreground' : 'background'}
            {...(entry.duration === undefined ? {} : { duration: entry.duration })}
            onOpenChange={(open) => {
              if (!open) setToasts((current) => current.filter((item) => item.id !== entry.id));
            }}
            className={cn(
              'flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-card-hover',
              'focus-visible:focus-ring',
            )}
          >
            <span className="flex shrink-0 pt-1">{icons[variant]}</span>
            <div className="flex flex-1 flex-col gap-1">
              <ToastPrimitive.Title className="font-body text-body-sm font-bold text-foreground">
                {entry.title}
              </ToastPrimitive.Title>
              {entry.description ? (
                <ToastPrimitive.Description className="font-body text-body-sm text-muted">
                  {entry.description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            <ToastPrimitive.Close
              aria-label={closeLabel}
              className="-m-2 inline-flex size-12 shrink-0 items-center justify-center rounded-pill text-muted hover:bg-background hover:text-foreground focus-visible:focus-ring"
            >
              <X aria-hidden="true" className="size-5" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-50 flex w-full flex-col gap-2 p-4 md:max-w-popover" />
    </ToastPrimitive.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = use(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return context;
}
