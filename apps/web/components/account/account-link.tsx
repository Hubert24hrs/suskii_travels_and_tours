'use client';

import { buttonVariants, cn } from '@suskii/ui-web';

import { AppLink } from '../app-link';

import { useSignedIn } from './use-account';

/**
 * The header's account entry: "Sign in" on the server and for visitors, "Account" once the
 * browser shows a session cookie. Labels come from the server (no catalog in this bundle).
 */
export function AccountLink({
  signInLabel,
  accountLabel,
}: {
  signInLabel: string;
  accountLabel: string;
}) {
  const signedIn = useSignedIn();
  return (
    <AppLink
      href={signedIn ? '/account' : '/sign-in'}
      className={cn(buttonVariants({ variant: 'ghost' }), 'ml-auto px-4')}
      data-testid="header-account"
    >
      {signedIn ? accountLabel : signInLabel}
    </AppLink>
  );
}
