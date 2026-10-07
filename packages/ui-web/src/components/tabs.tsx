'use client';

import {
  createContext,
  useContext,
  useId,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../lib/cn';

interface TabsContextValue {
  value: string;
  select: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(component: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) throw new Error(`${component} must be inside <Tabs>`);
  return context;
}

const safeId = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '_');

export interface TabsProps extends Omit<ComponentProps<'div'>, 'defaultValue' | 'onChange'> {
  /** Selected tab (controlled). */
  value?: string;
  /** Initially selected tab (uncontrolled). */
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

/**
 * WAI-ARIA tabs with automatic activation: arrow keys, Home and End move between tabs and select
 * them. Written without a library so the homepage search module stays small (ADR-013).
 */
export function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  children,
  ...props
}: TabsProps) {
  const baseId = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? '');
  const selected = value ?? uncontrolled;
  const select = (next: string) => {
    if (value === undefined) setUncontrolled(next);
    onValueChange?.(next);
  };
  return (
    <TabsContext.Provider value={{ value: selected, select, baseId }}>
      <div className={cn('flex flex-col gap-4', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }: ComponentProps<'div'>) {
  // Horizontally scrollable on small screens so all categories stay reachable.
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn('flex gap-2 overflow-x-auto border-b border-border', className)}
      {...props}
    />
  );
}

/** Arrow keys, Home and End move focus to another tab and select it (automatic activation). */
function moveFocus(event: KeyboardEvent<HTMLButtonElement>, select: (value: string) => void) {
  let list = event.currentTarget.parentElement;
  while (list && list.getAttribute('role') !== 'tablist') list = list.parentElement;
  if (!list) return;
  const tabs = Array.from(list.getElementsByTagName('button')).filter(
    (button) => button.getAttribute('role') === 'tab' && !button.disabled,
  );
  const current = tabs.indexOf(event.currentTarget);
  const target = {
    ArrowRight: tabs[(current + 1) % tabs.length],
    ArrowLeft: tabs[(current - 1 + tabs.length) % tabs.length],
    Home: tabs[0],
    End: tabs[tabs.length - 1],
  }[event.key];
  if (!target) return;
  event.preventDefault();
  target.focus();
  const next = target.dataset.value;
  if (next !== undefined) select(next);
}

export interface TabsTriggerProps extends Omit<ComponentProps<'button'>, 'value'> {
  value: string;
  icon?: ReactNode;
}

export function TabsTrigger({
  className,
  icon,
  children,
  value,
  onClick,
  onKeyDown,
  ...props
}: TabsTriggerProps) {
  const tabs = useTabs('TabsTrigger');
  const active = tabs.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${tabs.baseId}-tab-${safeId(value)}`}
      aria-controls={`${tabs.baseId}-panel-${safeId(value)}`}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-state={active ? 'active' : 'inactive'}
      data-value={value}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) tabs.select(value);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented) moveFocus(event, tabs.select);
      }}
      className={cn(
        '-mb-px inline-flex min-h-12 shrink-0 items-center gap-2 border-b-3 border-transparent px-4 font-body text-body-sm font-bold text-muted',
        'transition-colors duration-fast ease-standard hover:text-primary focus-visible:focus-ring',
        'aria-selected:border-primary aria-selected:text-primary',
        className,
      )}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="flex">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}

export interface TabsContentProps extends ComponentProps<'div'> {
  value: string;
}

/** Only the selected panel is mounted, as before (forms of other tabs keep no hidden state). */
export function TabsContent({ className, value, ...props }: TabsContentProps) {
  const tabs = useTabs('TabsContent');
  if (tabs.value !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${tabs.baseId}-panel-${safeId(value)}`}
      aria-labelledby={`${tabs.baseId}-tab-${safeId(value)}`}
      data-state="active"
      className={cn('focus-visible:focus-ring', className)}
      {...props}
    />
  );
}
