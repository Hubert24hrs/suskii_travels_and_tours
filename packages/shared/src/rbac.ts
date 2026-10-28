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
  // The data protection officer (Nigeria) or Information Officer (South Africa), ADR-089.
  'privacy_officer',
  // Cars (ADR-049): vetted independent drivers and bus operators' boarding agents. Neither is
  // Suskii staff: no console, no MFA requirement, and their routes check record ownership too.
  'driver',
  'operator_agent',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles held by people outside Suskii: travellers, drivers and operators' agents. */
export const NON_STAFF_ROLES: readonly Role[] = ['customer', 'driver', 'operator_agent'];

/** Staff roles must use MFA and may access /v1/admin routes. */
export const STAFF_ROLES: readonly Role[] = ROLES.filter((role) => !NON_STAFF_ROLES.includes(role));

export const PERMISSIONS = {
  'profile:manage': 'Manage own profile, sessions and MFA',
  'bookings:read': 'View any booking',
  'bookings:manage': 'Change, cancel and retry ticketing for bookings',
  'refunds:request': 'Create refund requests',
  'refunds:approve': 'Approve refunds (maker-checker above threshold)',
  'payments:review': 'Release or reject payments held by the risk score',
  'finance:reconcile': 'Review ledger reconciliation discrepancies and driver payouts',
  'users:read': 'View customer and staff accounts',
  'users:manage': 'Disable accounts and reset MFA',
  'roles:manage': 'Grant and revoke roles',
  'catalog:manage': 'Manage packages, tours, visa products and add-ons',
  'deals:manage': 'Manage deals and promo codes',
  'pricing:manage': 'Manage markup rules, fees, Suskii Prime plans and metasearch partners',
  'referrals:review': 'Approve or reject referrals held for fraud review',
  'cms:manage': 'Edit banners, destination content and FAQs',
  'reviews:moderate': "Publish or reject travellers' reviews",
  'trust-signals:verify': 'Mark regulated trust claims as verified with evidence',
  'visa:process': 'Review visa applications and documents',
  'support:manage': 'Handle support tickets',
  'status:manage': 'Open, update and resolve incidents on the public status page',
  'reports:read': 'View dashboards and reports',
  'audit:read': 'View the audit log',
  'privacy:manage': 'Record data rights requests and personal data breaches, and their notices',
  'ground:manage': 'Manage bus operators, routes and trips, ride fares and the rental fleet',
  'drivers:review': 'Review driver applications, documents and vehicles',
  'safety:manage': 'Handle SOS alerts and ride safety incidents',
  driving: 'Go online, accept and drive rides (approved drivers)',
  'tickets:scan': "Scan and board tickets for the agent's own bus operator",
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
    'ground:manage',
    'drivers:review',
    'safety:manage',
    'status:manage',
  ],
  finance: [
    'profile:manage',
    'bookings:read',
    'refunds:request',
    'refunds:approve',
    'payments:review',
    'finance:reconcile',
    'pricing:manage',
    'referrals:review',
    'reports:read',
  ],
  support: [
    'profile:manage',
    'bookings:read',
    'users:read',
    'refunds:request',
    'support:manage',
    'safety:manage',
    'reviews:moderate',
    'status:manage',
  ],
  // Regulated claims (IATA, traveller counts) are verified by super admins only.
  content_manager: [
    'profile:manage',
    'cms:manage',
    'catalog:manage',
    'deals:manage',
    'reviews:moderate',
  ],
  visa_officer: ['profile:manage', 'bookings:read', 'visa:process'],
  privacy_officer: ['profile:manage', 'users:read', 'audit:read', 'privacy:manage'],
  driver: ['profile:manage', 'driving'],
  operator_agent: ['profile:manage', 'tickets:scan'],
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
