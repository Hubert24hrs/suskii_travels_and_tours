/**
 * The database step of a release (ADR-060): apply pending migrations, then the reference-data
 * seed, which is idempotent and safe on every deploy. Runs once per release in the API's
 * `migrate` image (a Cloud Run job, a Helm pre-upgrade hook or a compose one-off), before any new
 * revision takes traffic. Migrations are expand/contract only (scripts/check-migrations.mjs), so
 * the revision still serving keeps working against the new schema.
 *
 * DATABASE_URL is the schema owner's. With DATABASE_APP_URL set, the last step creates or updates
 * the API's own role, which may only read and write rows (src/infra/app-role.ts).
 *
 *   node scripts/release-database.mjs        # needs DATABASE_URL, the API built (dist/)
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const prisma = join(apiDir, 'node_modules', 'prisma', 'build', 'index.js');
// The seed command in prisma.config.ts runs through `tsx` from the package's .bin directory.
const env = {
  ...process.env,
  PATH: `${join(apiDir, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
};

if (!process.env.DATABASE_URL) {
  process.stderr.write('release-database: DATABASE_URL is required\n');
  process.exit(1);
}
for (const step of [
  ['migrate', 'deploy'],
  ['db', 'seed'],
]) {
  process.stdout.write(`release-database: prisma ${step.join(' ')}\n`);
  const result = spawnSync(process.execPath, [prisma, ...step], {
    cwd: apiDir,
    env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.stderr.write(`release-database: prisma ${step.join(' ')} failed\n`);
    process.exit(result.status ?? 1);
  }
}
if (process.env.DATABASE_APP_URL) {
  const { ensureAppRole } = createRequire(import.meta.url)(
    join(apiDir, 'dist', 'infra', 'app-role.js'),
  );
  try {
    const { role, created } = await ensureAppRole(
      process.env.DATABASE_URL,
      process.env.DATABASE_APP_URL,
    );
    process.stdout.write(`release-database: app role ${role} ${created ? 'created' : 'updated'}\n`);
  } catch (error) {
    process.stderr.write(`release-database: ${error.message}\n`);
    process.exit(1);
  }
}
process.stdout.write('release-database: done\n');
