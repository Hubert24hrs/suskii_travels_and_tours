'use client';

import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { AuthLayout, SignInForm } from './auth';
import { useStaffSession } from './staff-session';

/**
 * Only same-origin paths: `next` comes from the address bar, and `//host` or `/\host` (browsers
 * read a backslash as a slash) would leave the console.
 */
function safeNext(next: string | null): Route {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')
    ? next
    : '/';
}

export function SignInPage() {
  const { session, reload } = useStaffSession();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));

  useEffect(() => {
    if (session.status === 'signed-in') router.replace(next);
  }, [session.status, next, router]);

  return (
    <AuthLayout>
      <SignInForm onSignedIn={() => void reload()} />
    </AuthLayout>
  );
}
