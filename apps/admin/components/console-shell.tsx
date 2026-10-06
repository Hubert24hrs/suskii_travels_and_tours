'use client';

import { Button, cn } from '@suskii/ui-web';
import { Menu } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { label, t } from '../lib/i18n';
import { NAV_ITEMS, visibleNav } from '../lib/permissions';

import { AuthLayout, MfaEnrolment, NotStaff } from './auth';
import { useStaffSession } from './staff-session';

const isActive = (pathname: string, href: string): boolean =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

/**
 * Everything behind the staff session: signed-out visitors go to sign-in, customers see that
 * they have no staff access, staff without an authenticator enrol first. Navigation lists only
 * the sections the staff member's roles allow; the API still checks every call.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const { session, signOut } = useStaffSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const ready = session.status === 'signed-in' && session.staff && session.user.mfaEnabled;
  // A page mounts (and queries the API) only for staff whose roles open its section.
  const section = NAV_ITEMS.find((item) => isActive(pathname, item.href));
  const allowed =
    ready && (!section || section.anyOf.some((permission) => session.permissions.has(permission)));
  // Staff without the dashboard land on their first section instead.
  const landing = ready && pathname === '/' && !allowed ? visibleNav(session.permissions)[0] : null;

  useEffect(() => {
    if (session.status === 'signed-out') {
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}` as Route);
    }
  }, [session.status, pathname, router]);

  useEffect(() => {
    if (landing) router.replace(landing.href);
  }, [landing, router]);

  if (session.status !== 'signed-in') {
    return (
      <main id="main" className="flex min-h-dvh items-center justify-center p-6">
        <p role="status" className="font-body text-body-sm text-muted">
          {t('common.loading')}
        </p>
      </main>
    );
  }
  if (!session.staff) {
    return (
      <AuthLayout>
        <NotStaff />
      </AuthLayout>
    );
  }
  if (!session.user.mfaEnabled) {
    return (
      <AuthLayout>
        <MfaEnrolment />
      </AuthLayout>
    );
  }

  const nav = visibleNav(session.permissions);
  const name = session.user.displayName ?? session.user.email ?? session.user.id;
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 bg-surface px-4 py-3 font-body font-bold text-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus-visible:focus-ring"
      >
        {t('common.skipToContent')}
      </a>
      <header className="border-b border-border bg-surface">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="admin-nav"
              aria-label={t('nav.menu')}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Menu aria-hidden="true" className="size-5" />
            </Button>
            <Link
              href="/"
              className="font-heading text-h4 font-extrabold text-primary focus-visible:focus-ring"
            >
              {t('common.appName')}
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden flex-col text-right md:flex">
              <span className="font-body text-body-sm text-foreground">
                {t('nav.signedInAs', { name })}
              </span>
              <span className="font-body text-caption text-muted">
                {t('nav.roles', {
                  roles: session.user.roles
                    .filter((role) => role !== 'customer')
                    .map((role) => label('roles', role))
                    .join(', '),
                })}
              </span>
            </div>
            <Button variant="ghost" onClick={() => void signOut()} data-testid="sign-out">
              {t('auth.signOut')}
            </Button>
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col lg:flex-row">
        <nav
          id="admin-nav"
          aria-label={t('nav.label')}
          className={cn(
            'border-b border-border bg-surface p-3 lg:block lg:border-r lg:border-b-0',
            menuOpen ? 'block' : 'hidden',
          )}
        >
          <ul className="flex flex-col gap-1">
            {nav.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      'block rounded-md px-3 py-2 font-body text-body-sm text-foreground hover:bg-primary-subtle focus-visible:focus-ring',
                      active && 'bg-primary-subtle font-bold text-primary',
                    )}
                  >
                    {t(item.label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main id="main" className="flex min-w-0 flex-1 flex-col gap-6 p-4 lg:p-8">
          {allowed ? (
            children
          ) : landing ? (
            <p role="status" className="font-body text-body-sm text-muted">
              {t('common.loading')}
            </p>
          ) : (
            <p role="alert" className="font-body text-body-sm text-danger">
              {t('common.forbidden')}
            </p>
          )}
        </main>
      </div>
    </div>
  );
}

/** Shows a page only to staff whose roles grant the permission (the API checks it again). */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Parameters<ReturnType<typeof useStaffSession>['can']>[0];
  children: ReactNode;
}) {
  const { can } = useStaffSession();
  if (!can(permission)) {
    return (
      <p role="alert" className="font-body text-body-sm text-danger">
        {t('common.forbidden')}
      </p>
    );
  }
  return <>{children}</>;
}
