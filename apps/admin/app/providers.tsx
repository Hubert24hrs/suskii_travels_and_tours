'use client';

import { ToastProvider } from '@suskii/ui-web';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { StaffSessionProvider } from '../components/staff-session';
import { problemOf } from '../lib/api';
import { t } from '../lib/i18n';

/** Retries only failures that may pass on a second try (network, 5xx), never 4xx answers. */
function retry(failures: number, error: unknown): boolean {
  const { status } = problemOf(error);
  return failures < 2 && (status === null || status >= 500);
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry, staleTime: 15_000, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider label={t('common.notifications')} closeLabel={t('common.dismiss')}>
        <StaffSessionProvider>{children}</StaffSessionProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
