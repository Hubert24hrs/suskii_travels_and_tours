/**
 * Incident response: signs accounts out in bulk and denylists their access tokens at once
 * (ADR-037, docs/runbooks/session-revocation.md). Counts only, unless --yes is given. Needs the
 * API's configuration (DATABASE_URL, REDIS_URL, HMAC_SECRET and the rest of the env schema).
 *
 *   pnpm --filter @suskii/api sessions:revoke --staff --reason incident-2026-10-06
 *   pnpm --filter @suskii/api sessions:revoke --staff --reason incident-2026-10-06 --yes
 *   pnpm --filter @suskii/api sessions:revoke --user <id> --reason account-takeover --yes
 *   pnpm --filter @suskii/api sessions:revoke --all --reason signing-key-rotation --yes
 */
import { Redis } from 'ioredis';

import { AuditService } from '../src/audit/audit.service';
import { parseIncidentArgs, revokeForIncident } from '../src/auth/incident-revocation';
import { loadConfig, loadDevelopmentEnvFile } from '../src/config/config';
import { HmacService } from '../src/crypto/hmac.service';
import { PrismaService } from '../src/infra/prisma.service';

async function main(): Promise<void> {
  const options = parseIncidentArgs(process.argv.slice(2));
  loadDevelopmentEnvFile();
  const config = loadConfig();
  const prisma = new PrismaService(config);
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, connectTimeout: 5000 });
  try {
    const result = await revokeForIncident(
      {
        prisma,
        redis,
        audit: new AuditService(prisma, new HmacService(config)),
        accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
      },
      options,
    );
    process.stdout.write(
      options.confirm
        ? `ended ${result.revoked} sessions (${options.scope.kind}, reason ${options.reason})\n`
        : `${result.matched} sessions would end (${options.scope.kind}); repeat with --yes\n`,
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
