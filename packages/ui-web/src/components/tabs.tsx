'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn('flex flex-col gap-4', className)} {...props} />;
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  // Horizontally scrollable on small screens so all categories stay reachable.
  return (
    <TabsPrimitive.List
      className={cn('flex gap-2 overflow-x-auto border-b border-border', className)}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends ComponentProps<typeof TabsPrimitive.Trigger> {
  icon?: ReactNode;
}

export function TabsTrigger({ className, icon, children, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
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
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('focus-visible:focus-ring', className)} {...props} />;
}
