import { describe, expect, it } from 'vitest';

import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  hasPermissions,
  isStaff,
  permissionsFor,
} from './rbac';

describe('rbac catalog', () => {
  it('defines permissions for every role, using only catalog permissions', () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(Object.keys(PERMISSIONS)).toContain(permission);
      }
    }
  });

  it('gives super admins everything and customers only their own profile', () => {
    expect(permissionsFor(['super_admin']).size).toBe(Object.keys(PERMISSIONS).length);
    expect([...permissionsFor(['customer'])]).toEqual(['profile:manage']);
  });

  it('restricts regulated trust-claim verification and role management to super admins', () => {
    for (const role of ROLES.filter((r) => r !== 'super_admin')) {
      expect(hasPermissions([role], ['trust-signals:verify'])).toBe(false);
      expect(hasPermissions([role], ['roles:manage'])).toBe(false);
    }
  });

  it('combines permissions across roles and requires all of them', () => {
    expect(hasPermissions(['support', 'finance'], ['support:manage', 'refunds:approve'])).toBe(
      true,
    );
    expect(hasPermissions(['support'], ['support:manage', 'refunds:approve'])).toBe(false);
  });

  it('treats every non-customer role as staff', () => {
    expect(STAFF_ROLES).not.toContain('customer');
    expect(isStaff(['customer'])).toBe(false);
    expect(isStaff(['customer', 'visa_officer'])).toBe(true);
  });
});
