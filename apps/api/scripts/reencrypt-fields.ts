/**
 * Field-encryption key rotation (ADR-038, docs/runbooks/key-rotation.md): rewrites every envelope
 * that is not under FIELD_ENCRYPTION_KEY_ID. Counts only, unless --yes is given. Run with the new
 * key as FIELD_ENCRYPTION_KEY and the old one in FIELD_ENCRYPTION_PREVIOUS_KEYS.
 *
 *   pnpm --filter @suskii/api keys:reencrypt
 *   pnpm --filter @suskii/api keys:reencrypt --yes
 */
import { parseArgs } from 'node:util';

import { loadConfig, loadDevelopmentEnvFile } from '../src/config/config';
import { reencryptFields } from '../src/crypto/encrypted-fields';
import { LocalKeyFieldEncryption } from '../src/crypto/field-encryption';
import { PrismaService } from '../src/infra/prisma.service';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { yes: { type: 'boolean', default: false } },
    strict: true,
  });
  loadDevelopmentEnvFile();
  const config = loadConfig();
  if (!config.FIELD_ENCRYPTION_KEY) throw new Error('FIELD_ENCRYPTION_KEY is required');
  const prisma = new PrismaService(config);
  try {
    const results = await reencryptFields(prisma, new LocalKeyFieldEncryption(config), {
      confirm: values.yes,
    });
    for (const result of results) {
      process.stdout.write(
        `${result.field.padEnd(42)} ${String(result.stale).padStart(8)} not under ${config.FIELD_ENCRYPTION_KEY_ID}` +
          (values.yes ? `, ${result.rewritten} rewritten\n` : '\n'),
      );
    }
    const left = results.reduce((sum, result) => sum + result.stale - result.rewritten, 0);
    process.stdout.write(
      values.yes
        ? `${left === 0 ? 'done' : `${left} left (changed during the run); run again`}\n`
        : 'dry run; repeat with --yes\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
