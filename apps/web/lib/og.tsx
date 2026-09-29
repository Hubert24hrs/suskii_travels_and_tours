import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { color } from '@suskii/design-tokens';

/** Plus Jakarta Sans for generated images (Satori reads WOFF, not WOFF2). */
export async function ogFonts() {
  const dir = join(process.cwd(), 'node_modules/@fontsource/plus-jakarta-sans/files');
  const [bold, medium] = await Promise.all([
    readFile(join(dir, 'plus-jakarta-sans-latin-800-normal.woff')),
    readFile(join(dir, 'plus-jakarta-sans-latin-500-normal.woff')),
  ]);
  return [
    { name: 'Plus Jakarta Sans', data: bold, weight: 800 as const, style: 'normal' as const },
    { name: 'Plus Jakarta Sans', data: medium, weight: 500 as const, style: 'normal' as const },
  ];
}

export { color };
