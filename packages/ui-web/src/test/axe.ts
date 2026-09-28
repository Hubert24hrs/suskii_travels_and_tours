import axe, { type Result } from 'axe-core';

/** WCAG 2.0-2.2 A and AA rules. Page-level best practices (landmarks, h1) do not apply to components. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export async function axeViolations(root: Element = document.body): Promise<Result[]> {
  const results = await axe.run(root, {
    runOnly: { type: 'tag', values: WCAG_TAGS },
    resultTypes: ['violations'],
  });
  return results.violations;
}

export function formatViolations(violations: Result[]): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact ?? 'n/a'}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`,
    )
    .join('\n');
}
