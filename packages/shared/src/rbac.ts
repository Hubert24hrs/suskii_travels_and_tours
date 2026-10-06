/**
 * Role-based access control catalog: the single source of truth for what each role may do.
 * The API guard checks it; the seed syncs it into the roles/permissions tables for the admin UI.
 */

export const ROLES = [
  'customer',
  'super_admin',
  'operations',
  'finance',
  'support',
  'content_manager',
  'visa_officer',
] as const;
export type Role = (typeof ROLES)[number];

/** Staff roles must use MFA and may access /v1/admin routes. */
export const STAFF_ROLES: readonly Role[] = ROLES.filter((role) => role !== 'customer');

export const PERMISSIONS = {
  'profile:manage': 'Manage own profile, sessions and MFA',
  'bookings:read': 'View any booking',
  'bookings:manage': 'Change, cancel and retry ticketing for bookings',
  'refunds:request': 'Create refund requests',
  'refunds:approve': 'Approve refunds (maker-checker above threshold)',
  'payments:review': 'Release or reject payments held by the risk score',
  'users:read': 'View customer and staff accounts',
  'users:manage': 'Disable accounts and reset MFA',
  'roles:manage': 'Grant and revoke roles',
  'catalog:manage': 'Manage packages, tours, visa products and add-ons',
  'deals:manage': 'Manage deals and promo codes',
  'pricing:manage': 'Manage markup rules, fees and Suskii Prime plans',
  'referrals:review': 'Approve or reject referrals held for fraud review',
  'cms:manage': 'Edit banners, destination content and FAQs',
  'trust-signals:verify': 'Mark regulated trust claims as verified with evidence',
  'visa:process': 'Review visa applications and documents',
  'support:manage': 'Handle support tickets',
  'reports:read': 'View dashboards and reports',
  'audit:read': 'View the audit log',
} as const;
export type Permission = keyof typeof PERMISSIONS;

const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  customer: ['profile:manage'],
  super_admin: ALL_PERMISSIONS,
  operations: [
    'profile:manage',
    'bookings:read',
    'bookings:manage',
    'refunds:request',
    'users:read',
    'catalog:manage',
    'deals:manage',
    'referrals:review',
    'reports:read',
  ],
  finance: [
    'profile:manage',
    'bookings:read',
    'refunds:request',
    'refunds:approve',
    'payments:review',
    'pricing:manage',
    'referrals:review',
    'reports:read',
  ],
  support: ['profile:manage', 'bookings:read', 'users:read', 'refunds:request', 'support:manage'],
  // Regulated claims (IATA, traveller counts) are verified by super admins only.
  content_manager: ['profile:manage', 'cms:manage', 'catalog:manage', 'deals:manage'],
  visa_officer: ['profile:manage', 'bookings:read', 'visa:process'],
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function permissionsFor(roles: readonly Role[]): ReadonlySet<Permission> {
  return new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]));
}

export function hasPermissions(roles: readonly Role[], required: readonly Permission[]): boolean {
  const granted = permissionsFor(roles);
  return required.every((permission) => granted.has(permission));
}

export function isStaff(roles: readonly Role[]): boolean {
  return roles.some((role) => STAFF_ROLES.includes(role));
}
