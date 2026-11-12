import { parseArgs } from 'node:util';

import { emailSchema } from '@suskii/shared';
import type { Redis } from 'ioredis';

import type { AuditService } from '../audit/audit.service';
import { revokeSessionsWhere } from '../auth/session.service';
import type { PrismaService } from '../infra/prisma.service';

export interface BootstrapOptions {
  email: string;
  /** Without it the command only checks that the grant would succeed. */
  confirm: boolean;
}

export const BOOTSTRAP_USAGE = `Usage: staff:bootstrap --email <address> [--yes]
  Grants super_admin to an existing account with a verified email while no super admin exists.
  The person signs up on the website or app first, then enrols an authenticator before the
  console lets them in. Every later role change goes through the console (step-up, audited).
  --yes   grant the role (otherwise only check)`;

/** Parses the command line; throws with the usage text on anything missing or extra. */
export function parseBootstrapArgs(argv: readonly string[]): BootstrapOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: { email: { type: 'string' }, yes: { type: 'boolean', default: false } },
    strict: true,
    allowPositionals: false,
  });
  const email = emailSchema.safeParse(values.email ?? '');
  if (!email.success) throw new Error(`--email must be an email address.\n${BOOTSTRAP_USAGE}`);
  return { email: email.data, confirm: values.yes };
}

export interface BootstrapDeps {
  prisma: PrismaService;
  redis: Pick<Redis, 'pipeline'>;
  audit: Pick<AuditService, 'record'>;
  accessTokenTtlSeconds: number;
}

export interface BootstrapResult {
  userId: string;
  granted: boolean;
}

/** Serialises concurrent runs so two accounts can never both become the first super admin. */
const LOCK_KEY = 'suskii:first-super-admin';

/**
 * The only way to create the first super admin in production, where `SEED_ADMIN_*` is refused
 * (ADR-060, docs/runbooks/deploy-and-rollback.md). It refuses once any super admin exists, so it
 * cannot be used to escalate later. Errors never echo the address.
 */
export async function grantFirstSuperAdmin(
  deps: BootstrapDeps,
  options: BootstrapOptions,
): Promise<BootstrapResult> {
  const userId = await deps.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`;
    if ((await tx.userRole.count({ where: { roleKey: 'super_admin' } })) > 0) {
      throw new Error('A super admin already exists; grant roles from the console instead.');
    }
    const user = await tx.user.findUnique({
      where: { email: options.email },
      include: { roles: true },
    });
    if (!user || user.deletedAt) {
      throw new Error('No account uses that email; sign up on the website or app first.');
    }
    if (!user.emailVerifiedAt) throw new Error('The account has not verified its email yet.');
    if (user.status !== 'active') throw new Error('The account is not active.');
    if (!options.confirm) return user.id;

    const before = user.roles.map((role) => role.roleKey).sort();
    await tx.userRole.create({ data: { userId: user.id, roleKey: 'super_admin' } });
    await deps.audit.record(
      {
        action: 'rbac.roles.changed',
        actorType: 'system',
        targetType: 'user',
        targetId: user.id,
        metadata: { before, after: [...before, 'super_admin'].sort(), reason: 'bootstrap' },
      },
      tx,
    );
    return user.id;
  });
  // Roles travel in access tokens: sign the account out so the next sign-in carries the role.
  if (options.confirm) {
    await revokeSessionsWhere(
      deps.prisma,
      deps.redis,
      { userId },
      'roles_changed',
      deps.accessTokenTtlSeconds,
    );
  }
  return { userId, granted: options.confirm };
}
