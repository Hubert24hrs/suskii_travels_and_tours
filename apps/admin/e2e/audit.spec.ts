import type { PersonaKey } from './personas';
import { expect, expectNoAxeViolations, signIn, t, test } from './fixtures';

/**
 * Runs after the console journeys (a project dependency): every change they made is in the audit
 * log under the staff member who made it.
 */
const EXPECTED: readonly { persona: PersonaKey; action: string; target: string }[] = [
  { persona: 'support', action: 'refund.created', target: 'refund' },
  { persona: 'finance', action: 'refund.approved', target: 'refund' },
  { persona: 'pricing', action: 'pricing.markup_created', target: 'markup_rule' },
  { persona: 'verifier', action: 'trust_signal.verified', target: 'trust_signal' },
  { persona: 'operations', action: 'promo.created', target: 'promo_code' },
  { persona: 'metasearch', action: 'metasearch_partner.key_rotated', target: 'metasearch_partner' },
  { persona: 'prime', action: 'prime.plan_updated', target: 'prime_plan' },
  { persona: 'supportAgent', action: 'support.replied', target: 'support_conversation' },
  { persona: 'privacyOfficer', action: 'privacy.breach_closed', target: 'privacy_breach' },
];

test('the audit log shows each staff change with its author', async ({ page, stack }) => {
  await signIn(page, stack, 'auditor');
  await page.goto('/audit');
  await expect(page.getByRole('table', { name: t('audit.title') })).toBeVisible();
  await expectNoAxeViolations(page);

  for (const { persona, action, target } of EXPECTED) {
    const actor = stack.personas[persona].id;
    await page.getByLabel(t('audit.filterAction')).fill(action);
    await page.getByLabel(t('audit.filterActor')).fill(actor);
    await page.getByRole('button', { name: t('common.apply') }).click();
    const rows = page.getByRole('table', { name: t('audit.title') }).getByRole('row');
    // Row 0 is the header; the newest matching entry comes first.
    await expect(rows.nth(1)).toContainText(action);
    await expect(rows.nth(1)).toContainText(actor);
    await expect(rows.nth(1)).toContainText(`${target}: `);
  }
});
