import { permissionsFor, type Permission, type Role } from '@suskii/shared';

import type { AdminKey } from './i18n';

export interface NavItem {
  href: string;
  label: AdminKey;
  /** Any one of these shows the item (the API still checks each route). */
  anyOf: readonly Permission[];
}

/** Console sections in menu order, each behind the permissions its API routes require. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'nav.dashboard', anyOf: ['reports:read'] },
  { href: '/bookings', label: 'nav.bookings', anyOf: ['bookings:read'] },
  { href: '/refunds', label: 'nav.refunds', anyOf: ['refunds:request'] },
  { href: '/payment-reviews', label: 'nav.paymentReviews', anyOf: ['payments:review'] },
  { href: '/vouchers', label: 'nav.vouchers', anyOf: ['bookings:manage'] },
  { href: '/catalog', label: 'nav.catalog', anyOf: ['catalog:manage'] },
  { href: '/pricing', label: 'nav.pricing', anyOf: ['pricing:manage'] },
  { href: '/promos', label: 'nav.promos', anyOf: ['deals:manage'] },
  { href: '/deals', label: 'nav.deals', anyOf: ['deals:manage', 'cms:manage'] },
  { href: '/content', label: 'nav.content', anyOf: ['cms:manage'] },
  { href: '/trust-signals', label: 'nav.trustSignals', anyOf: ['cms:manage'] },
  { href: '/users', label: 'nav.users', anyOf: ['users:read'] },
  { href: '/audit', label: 'nav.audit', anyOf: ['audit:read'] },
  { href: '/visa', label: 'nav.visa', anyOf: ['visa:process'] },
  { href: '/prime', label: 'nav.prime', anyOf: ['pricing:manage'] },
  { href: '/referrals', label: 'nav.referrals', anyOf: ['referrals:review'] },
];

export function grantedPermissions(roles: readonly Role[]): ReadonlySet<Permission> {
  return permissionsFor(roles);
}

export function visibleNav(granted: ReadonlySet<Permission>): NavItem[] {
  return NAV_ITEMS.filter((item) => item.anyOf.some((permission) => granted.has(permission)));
}
