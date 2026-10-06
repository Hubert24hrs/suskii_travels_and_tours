import { z } from 'zod';

import { ROLES } from '@suskii/shared';

import { named } from '../contract/contract';

export const adminUserSchema = named(
  'AdminUser',
  z.object({
    id: z.uuid(),
    email: z.email().nullable(),
    phone: z.string().nullable(),
    displayName: z.string().nullable(),
    status: z.enum(['active', 'disabled', 'deleted']),
    roles: z.array(z.enum(ROLES)),
    mfaEnabled: z.boolean(),
    createdAt: z.iso.datetime(),
  }),
);

export const setRolesBodySchema = named(
  'SetRolesRequest',
  z.object({ roles: z.array(z.enum(ROLES)).min(1).max(ROLES.length) }),
);

export const auditLogEntrySchema = named(
  'AuditLogEntry',
  z.object({
    id: z.uuid(),
    occurredAt: z.iso.datetime(),
    actorType: z.enum(['user', 'system', 'anonymous']),
    actorUserId: z.uuid().nullable(),
    action: z.string(),
    targetType: z.string().nullable(),
    targetId: z.string().nullable(),
    requestId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
  }),
);

export const auditLogPageSchema = named(
  'AuditLogPage',
  z.object({ items: z.array(auditLogEntrySchema), nextCursor: z.uuid().nullable() }),
);

export const auditLogQuerySchema = z.object({
  cursor: z.uuid().optional().meta({ description: 'Id of the last entry of the previous page.' }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().max(100).optional(),
  actorUserId: z.uuid().optional(),
});

export const userIdParamsSchema = z.object({ id: z.uuid() });

export const booleanParam = z.enum(['true', 'false']).transform((value) => value === 'true');

export const adminUserQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2)
    .max(254)
    .optional()
    .meta({ description: 'The start of an email address, or a phone number in E.164.' }),
  status: z.enum(['active', 'disabled', 'deleted']).optional(),
  staffOnly: booleanParam.optional(),
  cursor: z.uuid().optional().meta({ description: 'Id of the last user of the previous page.' }),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const adminUserPageSchema = named(
  'AdminUserPage',
  z.object({ items: z.array(adminUserSchema), nextCursor: z.uuid().nullable() }),
);
