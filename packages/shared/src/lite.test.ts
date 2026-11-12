import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as lite from './lite';
import * as main from './index';

const SRC = dirname(fileURLToPath(import.meta.url));

/** Every module reachable from `file` through relative imports. */
function reachable(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const source = readFileSync(join(SRC, file), 'utf8');
  for (const [, path] of source.matchAll(/from '\.\/([^']+)'/g)) reachable(`${path}.ts`, seen);
  return seen;
}

describe('@suskii/shared/lite', () => {
  it('never reaches Zod, directly or through another module', () => {
    const importsZod = [...reachable('lite.ts')].filter((file) =>
      readFileSync(join(SRC, file), 'utf8').includes("from 'zod'"),
    );
    expect(importsZod).toEqual([]);
  });

  it('exports the same values as the main entry', () => {
    for (const [name, value] of Object.entries(lite)) {
      expect(main[name as keyof typeof main], name).toBe(value);
    }
  });
});

describe('zod-setup', () => {
  it('is the only module that imports Zod, so browsers turn off its JIT before any schema', () => {
    const direct = readdirSync(SRC).filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.endsWith('.test.ts') &&
        file !== 'zod-setup.ts' &&
        /from 'zod(?:\/[^']*)?'/.test(readFileSync(join(SRC, file), 'utf8')),
    );
    expect(direct).toEqual([]);
  });
});
