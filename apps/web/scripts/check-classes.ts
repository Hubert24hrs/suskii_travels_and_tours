/**
 * Fails when a Tailwind class used in apps/web does not exist in the compiled CSS. The design
 * tokens replace Tailwind's default scales (only token spacing, colours and sizes exist), and
 * Tailwind silently drops unknown classes, so a typo or off-scale value (`pb-24`) would otherwise
 * ship as missing styles. Run after `next build`.
 *
 *   pnpm --filter @suskii/web check:classes
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
/** App sources plus the component library, whose classes the app's CSS compiles via @source. */
const SOURCES = ['app', 'components', '../../packages/ui-web/src/components'];

const walk = (dir: string, pattern: RegExp): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path, pattern);
    return pattern.test(entry) ? [path] : [];
  });

const css = walk(join(ROOT, '.next', 'static'), /\.css$/)
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
if (!css) {
  process.stderr.write('No compiled CSS found in .next/static: run `next build` first.\n');
  process.exit(1);
}

/** Tailwind's selector escaping for a class name. */
const escapeClass = (name: string): string =>
  name.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`).replace(/^(\d)/, '\\3$1 ');

/**
 * Utilities whose values come from the token scales (spacing, sizes, colours, type). Only these
 * are checked, so ordinary strings such as locale codes never produce false positives.
 */
const UTILITY =
  /^-?(p[xytrbl]?|m[xytrbl]?|gap(-[xy])?|space-[xy]|w|h|size|min-[wh]|max-[wh]|inset(-[xy])?|top|right|bottom|left|text|bg|border(-[xytrbl])?|rounded(-[a-z]+)?|shadow|font|leading|tracking|grid-cols|col-span|row-span|z|opacity|fill|stroke|translate-[xy]|duration|ease|ring|outline|accent|divide(-[xy])?|aspect|basis|scroll-[mp][xytrbl]?)-[\w./]+$/;

/** Every whitespace-separated token inside string and template literals. */
function classTokens(source: string): string[] {
  const tokens: string[] = [];
  for (const literal of source.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    const text = (literal[2] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    for (const token of text.split(/\s+/)) {
      const utility = token.split(':').pop() ?? '';
      if (UTILITY.test(utility.replace(/^!/, ''))) tokens.push(token);
    }
  }
  return tokens;
}

const missing: string[] = [];
for (const dir of SOURCES) {
  for (const file of walk(join(ROOT, dir), /\.tsx?$/).filter(
    (path) => !path.endsWith('.stories.tsx'),
  )) {
    const source = readFileSync(file, 'utf8');
    for (const token of new Set(classTokens(source))) {
      if (!css.includes(`.${escapeClass(token)}`))
        missing.push(`${relative(ROOT, file)}: ${token}`);
    }
  }
}

if (missing.length > 0) {
  process.stderr.write(
    `Classes with no generated CSS (off-scale or misspelled):\n  ${missing.join('\n  ')}\n`,
  );
  process.exit(1);
}
process.stdout.write('Every Tailwind class used in apps/web has generated CSS.\n');
