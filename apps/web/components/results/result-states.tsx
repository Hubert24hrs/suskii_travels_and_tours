'use client';

import { Button, Card, Skeleton } from '@suskii/ui-web';
import type { ReactNode } from 'react';

/** Placeholder cards while suppliers are searched; the container announces the wait. */
export function ResultsLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <p className="font-body text-body text-foreground">{label}</p>
      {[0, 1, 2].map((index) => (
        <Card key={index} className="flex flex-col gap-3 p-4">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-10 w-full" />
        </Card>
      ))}
    </div>
  );
}

/** An empty, failed or expired result list with one clear next step. */
export function ResultsMessage({
  children,
  action,
  onAction,
  tone = 'status',
}: {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
  tone?: 'status' | 'alert';
}) {
  return (
    <Card role={tone} className="flex flex-col items-start gap-4 p-6">
      <p className="font-body text-body text-foreground">{children}</p>
      {action && onAction ? (
        <Button variant="secondary" onClick={onAction}>
          {action}
        </Button>
      ) : null}
    </Card>
  );
}
