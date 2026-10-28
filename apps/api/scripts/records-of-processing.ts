/**
 * Writes docs/privacy/records-of-processing.md from the processing activities, the recipients and
 * the data registry (ADR-089). `processing-records.spec.ts` fails while the page is stale.
 *
 *   pnpm --filter @suskii/api privacy:records
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderRecordsOfProcessing } from '../src/privacy/processing-records';

const target = resolve(__dirname, '../../../docs/privacy/records-of-processing.md');
writeFileSync(target, renderRecordsOfProcessing());
process.stdout.write(`wrote ${target}\n`);
