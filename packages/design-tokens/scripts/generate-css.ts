// Writes the CSS artefacts next to the tsup output. Runs after `tsup` in `pnpm build`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCssVariables } from '../src/css-variables';
import { getTailwindThemeCss } from '../src/tailwind-theme';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'theme.css'), getTailwindThemeCss());
writeFileSync(join(dist, 'tokens.css'), getCssVariables());
