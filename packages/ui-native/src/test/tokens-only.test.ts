import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const componentsDir = join(__dirname, '..', 'components');
const sources = readdirSync(componentsDir)
  .filter((file) => file.endsWith('.tsx'))
  .map((file) => ({ file, source: readFileSync(join(componentsDir, file), 'utf8') }));

const codeLines = (source: string): string[] =>
  source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));

const stringLiterals = (line: string): string[] =>
  [...line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((match) =>
    // Drop template interpolations: `${items[index]}` is code, not a class name.
    (match[2] ?? '').replace(/\$\{[^}]*\}/g, ''),
  );

const hasArbitraryValue = (token: string): boolean =>
  token.replace(/\[[^\]]*\]:/g, '').includes('[');

const RULES: { name: string; test: (line: string) => boolean }[] = [
  { name: 'hex colour literal', test: (line) => /#[0-9a-f]{3,8}\b/i.test(line) },
  { name: 'rgb()/hsl() colour literal', test: (line) => /\b(?:rgba?|hsla?)\(/i.test(line) },
  { name: 'px/rem length literal', test: (line) => /\b\d+(?:\.\d+)?(?:px|rem|em)\b/.test(line) },
  // Inline styles may carry runtime values (safe-area insets, animated values) but no literals.
  { name: 'inline style literal', test: (line) => /\bstyle=\{\{[^}]*(?:\d|#)/.test(line) },
  {
    name: 'numeric visual style',
    test: (line) =>
      /\b(?:fontSize|lineHeight|borderRadius|borderWidth|padding\w*|margin\w*|width|height|gap|size)\s*[:=]\s*\{?\s*\d/.test(
        line,
      ),
  },
  {
    name: 'arbitrary Tailwind value',
    test: (line) =>
      stringLiterals(line).some((literal) => literal.split(/\s+/).some(hasArbitraryValue)),
  },
];

/** Acceptance criterion "all components consume tokens only" (native). */
describe('native components use design tokens only', () => {
  it('found the component sources', () => {
    expect(sources.length).toBeGreaterThanOrEqual(15);
  });

  it('detects the patterns it guards against', () => {
    for (const line of [
      "className='w-[13px]'",
      "color='#004BBE'",
      'style={{ padding: 12 }}',
      'size={20}',
    ]) {
      expect(RULES.some((rule) => rule.test(line))).toBe(true);
    }
  });

  it.each(sources)('$file has no hardcoded visual values', ({ source }) => {
    const offences = codeLines(source).flatMap((line) =>
      RULES.filter((rule) => rule.test(line)).map((rule) => `${rule.name}: ${line.trim()}`),
    );
    expect(offences).toEqual([]);
  });
});
