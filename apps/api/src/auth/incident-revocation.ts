import { parseArgs } from 'node:util';

import type { Redis } from 'ioredis';

import type { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../infra/prisma.service';

import { revokeSessionsWhere } from './session.service';

export type IncidentScope = { kind: 'all' } | { kind: 'staff' } | { kind: 'user'; userId: string };

export interface IncidentOptions {
  scope: IncidentScope;
  /** A short slug stored on every session and in the audit entry (`incident-2026-10-06`). */
  reason: string;
  /** Without it the command only counts what it would end. */
  confirm: boolean;
}

const REASON = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const INCIDENT_USAGE = `Usage: sessions:revoke (--all | --staff | --user <id>) --reason <slug> [--yes]
  --all            every signed-in session
  --staff          sessions of accounts with any role besides customer
  --user <id>      every session of one account
  --reason <slug>  lower case, 3 to 64 characters, e.g. incident-2026-10-06
  --yes            end the sessions (otherwise only count them)`;

/** Parses the command line; throws with the usage text on anything ambiguous. */
export function parseIncidentArgs(argv: readonly string[]): IncidentOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      all: { type: 'boolean', default: false },
      staff: { type: 'boolean', default: false },
      user: { type: 'string' },
      reason: { type: 'string' },
      yes: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const scopes = [values.all, values.staff, values.user !== undefined].filter(Boolean).length;
  if (scopes !== 1) throw new Error(`Choose exactly one scope.\n${INCIDENT_USAGE}`);
  if (!values.reason || !REASON.test(values.reason))
    throw new Error(`--reason must be a slug.\n${INCIDENT_USAGE}`);
  let scope: IncidentScope;
  if (values.user !== undefined) {
    if (!UUID.test(values.user))
      throw new Error(`--user must be an account id.\n${INCIDENT_USAGE}`);
    scope = { kind: 'user', userId: values.user.toLowerCase() };
  } else {
    scope = values.all ? { kind: 'all' } : { kind: 'staff' };
  }
  return { scope, reason: values.reason, confirm: values.yes };
}

function scopeWhere(scope: IncidentScope): Prisma.SessionWhereInput {
  switch (scope.kind) {
    case 'all':
      return {};
    case 'staff':
      return { user: { roles: { some: { roleKey: { not: 'customer' } } } } };
    case 'user':
      return { userId: scope.userId };
  }
}

export interface IncidentDeps {
  prisma: Pick<PrismaService, 'session' | 'refreshToken' | '$transaction'>;
  redis: Pick<Redis, 'pipeline'>;
  audit: Pick<AuditService, 'record'>;
  accessTokenTtlSeconds: number;
}

/**
 * Ends sessions in bulk during an incident (ADR-037, docs/runbooks/session-revocation.md): the
 * same revocation as a sign-out (sessions, refresh tokens, access-token denylist), audited once as
 * a system action. Returns how many sessions matched (dry run) or ended.
 */
export async function revokeForIncident(
  deps: IncidentDeps,
  options: IncidentOptions,
): Promise<{ matched: number; revoked: number }> {
  const where = scopeWhere(options.scope);
  const matched = await deps.prisma.session.count({ where: { ...where, revokedAt: null } });
  if (!options.confirm) return { matched, revoked: 0 };
  const revoked = await revokeSessionsWhere(
    deps.prisma,
    deps.redis,
    where,
    options.reason,
    deps.accessTokenTtlSeconds,
  );
  await deps.audit.record({
    action: 'auth.sessions.revoked_incident',
    actorType: 'system',
    ...(options.scope.kind === 'user'
      ? { targetType: 'user', targetId: options.scope.userId }
      : {}),
    metadata: { scope: options.scope.kind, reason: options.reason, revoked },
  });
  return { matched, revoked };
}
