import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, type Role } from '@suskii/shared';

import type { PrismaClient } from '../generated/prisma/client';

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  customer: 'Books and manages their own trips',
  super_admin: 'Full access, including roles and trust-signal verification',
  operations: 'Bookings, catalog, deals and pricing',
  finance: 'Refund approvals and financial reports',
  support: 'Customer support and bookings',
  content_manager: 'CMS content',
  visa_officer: 'Visa applications and documents',
};

/**
 * Mirrors the code catalog (@suskii/shared) into the roles/permissions tables so foreign keys,
 * reporting and the admin console see the same data the guards enforce. Idempotent.
 */
export async function syncRbacCatalog(prisma: Pick<PrismaClient, '$transaction'>): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await tx.permission.upsert({
        where: { key },
        create: { key, description },
        update: { description },
      });
    }
    for (const role of ROLES) {
      const description = ROLE_DESCRIPTIONS[role];
      await tx.role.upsert({
        where: { key: role },
        create: { key: role, description },
        update: { description },
      });
      await tx.rolePermission.deleteMany({ where: { roleKey: role } });
      await tx.rolePermission.createMany({
        data: ROLE_PERMISSIONS[role].map((permissionKey) => ({ roleKey: role, permissionKey })),
      });
    }
  });
}
