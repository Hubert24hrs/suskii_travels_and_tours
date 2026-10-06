import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';
import { createTranslator } from '@suskii/i18n';
import { adminMessages, type AdminMessages } from '@suskii/i18n/admin';

import { readState, type PersonaKey, type StackState } from './personas';
import { totp } from './totp';

/** The console catalog, so tests never hard-code copy. */
export const t = createTranslator<AdminMessages>(adminMessages, 'en-NG').t;

interface Fixtures {
  /** Console errors matching these patterns do not fail the test (e.g. an expected 400). */
  allowedConsoleErrors: RegExp[];
  /** Fails the test on uncaught page errors and console errors (CSP, React). */
  consoleGuard: void;
  stack: StackState;
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
      await use();
      expect(problems, 'browser errors during the test').toEqual([]);
    },
    { auto: true },
  ],
  // `provide` rather than `use`: the React hooks lint rule would read `use` as a hook.
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take a destructured object.
  stack: async ({}, provide) => {
    await provide(readState());
  },
});

export { expect };

/** Opens the sign-in page and submits the persona's email and password. */
export async function submitPassword(
  page: Page,
  stack: StackState,
  key: PersonaKey,
  next?: string,
) {
  const persona = stack.personas[key];
  await page.goto(next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in');
  await page.getByTestId('sign-in-email').fill(persona.email);
  await page.getByTestId('sign-in-password').fill(persona.password);
  await page.getByRole('button', { name: t('auth.submit') }).click();
}

/**
 * Signs a persona in with password and authenticator code. The code is the next step's: the
 * provisioning enrolment may have used the current one, and the API refuses a code twice.
 */
export async function signIn(page: Page, stack: StackState, key: PersonaKey): Promise<void> {
  const { secret } = stack.personas[key];
  if (!secret) throw new Error(`${key} has no authenticator`);
  await submitPassword(page, stack, key);
  await page.getByTestId('mfa-code').fill(totp(secret, 1));
  await page.getByRole('button', { name: t('auth.verify') }).click();
  // The navigation is folded behind the menu button on narrow screens; sign-out never is.
  await expect(page.getByTestId('sign-out')).toBeVisible();
}

/** An alert with this text (Next's route announcer is an empty alert on every page). */
export const alertWith = (page: Page, text: string) =>
  page.getByRole('alert').filter({ hasText: text });

/** A toast with this title (the live region repeats it with a prefix). */
export async function expectToast(page: Page, text: string): Promise<void> {
  await expect(page.getByText(text, { exact: true })).toBeVisible();
}

/** The section links the navigation shows. */
export async function navLabels(page: Page): Promise<string[]> {
  return page
    .getByRole('navigation', { name: t('nav.label') })
    .getByRole('link')
    .allInnerTexts();
}

export async function expectNoAxeViolations(page: Page): Promise<void> {
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
