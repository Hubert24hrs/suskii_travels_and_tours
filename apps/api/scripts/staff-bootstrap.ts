/**
 * Grants super_admin to the first staff account of a new environment (ADR-060). Checks only,
 * unless --yes is given; refuses once any super admin exists. Needs the API's configuration. In a
 * deployed environment it runs as the `ops` Cloud Run job (docs/runbooks/deploy-and-rollback.md):
 *
 *   pnpm --filter @suskii/api staff:bootstrap --email owner@example.com
 *   pnpm --filter @suskii/api staff:bootstrap --email owner@example.com --yes
 */
import { Redis } from 'ioredis';

import { grantFirstSuperAdmin, parseBootstrapArgs } from '../src/admin/first-super-admin';
import { AuditService } from '../src/audit/audit.service';
import { loadConfig, loadDevelopmentEnvFile } from '../src/config/config';
import { HmacService } from '../src/crypto/hmac.service';
import { PrismaService } from '../src/infra/prisma.service';
import { redisTls } from '../src/infra/redis-options';

async function main(): Promise<void> {
  const options = parseBootstrapArgs(process.argv.slice(2));
  loadDevelopmentEnvFile();
  const config = loadConfig();
  const prisma = new PrismaService(config);
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    ...redisTls(config),
  });
  try {
    const result = await grantFirstSuperAdmin(
      {
        prisma,
        redis,
        audit: new AuditService(prisma, new HmacService(config)),
        accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
      },
      options,
    );
    process.stdout.write(
      result.granted
        ? `super_admin granted to account ${result.userId}; it must sign in again and enrol an authenticator\n`
        : `account ${result.userId} can be granted super_admin; repeat with --yes\n`,
    );
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
