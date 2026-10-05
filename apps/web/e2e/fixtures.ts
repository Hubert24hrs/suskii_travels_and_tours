import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';
import { createTranslator, getMessages, type Messages, type Translator } from '@suskii/i18n';

/** The catalog the site renders by default (en-NG), so tests never hard-code copy. */
const translator = createTranslator(getMessages('en-NG'), 'en-NG');
export const t: Translator<Messages>['t'] = translator.t;

/** DevTools issue codes that fail a test (CSP, mixed content, unnamed form fields, CORS). */
const REPORTED_ISSUES = new Set([
  'ContentSecurityPolicyIssue',
  'MixedContentIssue',
  'GenericIssue',
  'CorsIssue',
  'QuirksModeIssue',
]);

interface Fixtures {
  /** Console errors matching these patterns do not fail the test (e.g. an expected 404). */
  allowedConsoleErrors: RegExp[];
  /** Fails the test on uncaught page errors and console errors (hydration, CSP, React). */
  consoleGuard: void;
}

export const test = base.extend<Fixtures>({
  allowedConsoleErrors: [[], { option: true }],
  consoleGuard: [
    async ({ page, allowedConsoleErrors }, use) => {
      const problems: string[] = [];
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (!allowedConsoleErrors.some((pattern) => pattern.test(text)))
          problems.push(`console: ${text}`);
      });
      // DevTools issues never reach the console (e.g. a CSP-blocked eval probe) but Lighthouse
      // counts them against best practices.
      const cdp = await page.context().newCDPSession(page);
      cdp.on('Audits.issueAdded', ({ issue }) => {
        if (REPORTED_ISSUES.has(issue.code))
          problems.push(`devtools issue: ${issue.code} ${JSON.stringify(issue.details)}`);
      });
      await cdp.send('Audits.enable');
      await use();
      expect(problems, 'browser errors during the test').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The breakpoints from the phase 4 acceptance criteria. */
export const VIEWPORTS = [
  { name: 'mobile', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

export async function expectNoAxeViolations(page: Page): Promise<void> {
  // Next streams `generateMetadata` on dynamic pages: after a client-side navigation the new
  // <title> can land just after the content. Check the finished page; a page that never gets a
  // title still fails here.
  await expect(page, 'the page title').not.toHaveTitle('');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const summary = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'n/a'}): ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(' '))
        .join(', ')}`,
  );
  expect(summary, 'axe violations').toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal page overflow in px').toBeLessThanOrEqual(0);
}

/** A date `days` from today as YYYY-MM-DD in the browser's (Lagos) calendar. */
export function isoDaysFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(date);
}
