import { describe, expect, it } from 'vitest';

// Raw source of every component (stories and tests excluded).
const sources = import.meta.glob<string>(['../components/*.tsx', '!../components/*.stories.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const codeLines = (source: string): string[] =>
  source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));

/** Contents of every quoted string or template literal (class names live there). */
const stringLiterals = (line: string): string[] =>
  [...line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((match) =>
    // Drop template interpolations: `${items[index]}` is code, not a class name.
    (match[2] ?? '').replace(/\$\{[^}]*\}/g, ''),
  );

/**
 * A class token with an arbitrary value (`w-[13px]`, `[scrollbar-width:none]`). Arbitrary
 * variants such as `data-[state=open]:` or `[&>svg]:` only select states and are allowed.
 */
const hasArbitraryValue = (token: string): boolean =>
  token.replace(/\[[^\]]*\]:/g, '').includes('[');

const RULES: { name: string; test: (line: string) => boolean }[] = [
  { name: 'hex colour literal', test: (line) => /#[0-9a-f]{3,8}\b/i.test(line) },
  { name: 'rgb()/hsl() colour literal', test: (line) => /\b(?:rgba?|hsla?)\(/i.test(line) },
  { name: 'px/rem/em length literal', test: (line) => /\b\d+(?:\.\d+)?(?:px|rem|em)\b/.test(line) },
  { name: 'inline style prop', test: (line) => /\bstyle=\{/.test(line) },
  {
    name: 'arbitrary Tailwind value',
    test: (line) =>
      stringLiterals(line).some((literal) => literal.split(/\s+/).some(hasArbitraryValue)),
  },
];

/** Acceptance criterion "all components consume tokens only". */
describe('components use design tokens only', () => {
  it('found the component sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(15);
  });

  it('detects the patterns it guards against', () => {
    const offending = [
      'className="w-[13px]"',
      "cn('text-[#fff]')",
      'style={{ color: "red" }}',
      "'#004BBE'",
    ];
    for (const line of offending) {
      expect(
        RULES.some((rule) => rule.test(line)),
        line,
      ).toBe(true);
    }
    expect(
      RULES.some((rule) => rule.test("cn('data-[state=open]:bg-primary [&>svg]:size-4')")),
    ).toBe(false);
  });

  for (const [path, source] of Object.entries(sources)) {
    it(`${path.replace('../components/', '')} has no hardcoded visual values`, () => {
      const offences = codeLines(source).flatMap((line) =>
        RULES.filter((rule) => rule.test(line)).map((rule) => `${rule.name}: ${line.trim()}`),
      );
      expect(offences).toEqual([]);
    });
  }
});
