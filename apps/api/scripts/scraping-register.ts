/**
 * Prints the scraping register (ADR-102) of the environment it runs in as Markdown: every
 * website price intelligence may read or must never read, with its basis. It only reads. In a
 * deployed environment it runs as the `ops` Cloud Run job and its output is the document for
 * counsel. `--write` also writes `docs/legal/scraping-register.md` in a checkout; `--blank`
 * renders the page of an empty registry without a database, which is what the repository
 * keeps (`scraping-register.spec.ts` checks its explanation against the code).
 *
 *   pnpm --filter @suskii/api price-intel:register                  # print this environment's
 *   pnpm --filter @suskii/api price-intel:register --blank --write  # the repository's page
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { loadConfig, loadDevelopmentEnvFile } from '../src/config/config';
import { PrismaService } from '../src/infra/prisma.service';
import { renderScrapingRegister, scrapingRegisterRows } from '../src/price-intel/scraping-register';

async function fromRegistry(): Promise<string> {
  loadDevelopmentEnvFile();
  const config = loadConfig();
  const prisma = new PrismaService(config);
  try {
    return renderScrapingRegister({
      rows: await scrapingRegisterRows(prisma),
      generatedAt: new Date().toISOString(),
      environment: config.NODE_ENV,
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      write: { type: 'boolean', default: false },
      blank: { type: 'boolean', default: false },
    },
  });
  const page = values.blank
    ? renderScrapingRegister({ rows: [], generatedAt: null, environment: null })
    : await fromRegistry();
  process.stdout.write(page);
  if (values.write) {
    const target = resolve(__dirname, '../../../docs/legal/scraping-register.md');
    writeFileSync(target, page);
    process.stderr.write(`wrote ${target}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
