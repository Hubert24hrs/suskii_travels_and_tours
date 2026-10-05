'use client';

import { Button, Card, Skeleton, cn } from '@suskii/ui-web';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, type ReactNode } from 'react';

import { AppLink } from '../app-link';

import { useAccountT } from './account-messages';
import { signOut, useAccount, type AuthUser } from './use-account';

interface AccountValue {
  user: AuthUser;
  replaceUser: (user: AuthUser) => void;
  reload: () => void;
}

const AccountContext = createContext<AccountValue | null>(null);

/** The signed-in user inside `/account/*`. */
export function useAccountUser(): AccountValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccountUser must be used inside <AccountShell>');
  return value;
}

const SECTIONS = [
  ['/account', 'overview'],
  ['/account/trips', 'trips'],
  ['/account/travellers', 'travellers'],
  ['/account/notifications', 'notifications'],
  ['/account/security', 'security'],
  ['/account/prime', 'prime'],
  ['/account/referrals', 'referrals'],
  ['/account/alerts', 'alerts'],
  ['/account/wallet', 'wallet'],
  ['/account/privacy', 'privacy'],
] as const;

/**
 * The account area: loads the user, sends visitors to sign in (and back here afterwards), and
 * frames each section with the navigation.
 */
export function AccountShell({ children }: { children: ReactNode }) {
  const { t } = useAccountT();
  const pathname = usePathname();
  const router = useRouter();
  const { phase, reload, replaceUser } = useAccount();

  useEffect(() => {
    if (phase.kind === 'signedOut') {
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
    }
  }, [phase.kind, pathname, router]);

  if (phase.kind === 'error') {
    return (
      <Card role="alert" className="flex flex-col items-start gap-4 p-6">
        <p className="font-body text-body text-foreground">{t('account.loadError')}</p>
        <Button onClick={reload}>{t('account.retry')}</Button>
      </Card>
    );
  }
  if (phase.kind !== 'ready') {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const { user } = phase;
  const name = user.displayName ?? user.email ?? user.phone ?? '';
  return (
    <AccountContext.Provider value={{ user, replaceUser, reload }}>
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <nav aria-label={t('account.nav.label')} className="md:w-1/4 md:shrink-0">
          <p className="mb-4 font-body text-body-sm text-muted">
            {t('account.signedInAs', { name })}
          </p>
          <ul className="flex gap-2 overflow-x-auto pb-2 md:flex-col md:overflow-visible">
            {SECTIONS.map(([href, key]) => {
              const active = pathname === href;
              return (
                <li key={href} className="shrink-0">
                  <AppLink
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-12 w-full items-center rounded-md px-4 font-body text-body-sm font-bold focus-visible:focus-ring',
                      active
                        ? 'bg-primary-subtle text-primary'
                        : 'text-foreground hover:text-primary',
                    )}
                  >
                    {t(`account.nav.${key}`)}
                  </AppLink>
                </li>
              );
            })}
            <li className="shrink-0">
              <Button
                variant="ghost"
                className="w-full justify-start"
                data-testid="sign-out"
                onClick={() =>
                  void signOut().then(() => {
                    router.replace('/');
                    router.refresh();
                  })
                }
              >
                {t('account.nav.signOut')}
              </Button>
            </li>
          </ul>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
      </div>
    </AccountContext.Provider>
  );
}

/** A titled card for one part of a section. */
export function AccountCard({
  heading,
  intro,
  children,
  testId,
}: {
  heading: string;
  intro?: string | undefined;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Card className="flex flex-col gap-4 p-6" data-testid={testId}>
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-h4 font-bold text-heading">{heading}</h2>
        {intro ? <p className="font-body text-body-sm text-muted">{intro}</p> : null}
      </div>
      {children}
    </Card>
  );
}

export function StatusLine({ message }: { message: string | null }) {
  return message ? (
    <p role="status" className="font-body text-body-sm text-success">
      {message}
    </p>
  ) : null;
}

export function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="font-body text-body-sm text-danger">
      {message}
    </p>
  ) : null;
}
