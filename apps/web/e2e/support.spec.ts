import { expect, expectNoAxeViolations, t, test } from './fixtures';

/**
 * Support conversations on the website (ADR-083). Who can open what, staff replies and the
 * SLA rules are covered against the API (`apps/api/test/support.e2e-spec.ts`) and in the
 * console; here a visitor writes to us, gets the after-hours assistant's answer from an FAQ
 * (ADR-085; the stack has no staffed hours), keeps writing and marks it solved.
 */
// A tab without the guest's token gets 404 from the API on purpose.
test.use({ allowedConsoleErrors: [/404/] });

test('a visitor starts a conversation, replies and marks it solved', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: t('header.utilityNav') })
    .getByRole('link', { name: t('support.link') })
    .click();
  await page.waitForURL(/\/support$/);
  await expect(page.getByRole('heading', { level: 1, name: t('support.heading') })).toBeVisible();
  await expectNoAxeViolations(page);

  const form = page.getByTestId('support-start');
  await form.getByLabel(t('support.start.category')).selectOption('payment');
  await form.getByLabel(t('support.start.message')).fill('Can I pay for my flight in instalments?');
  await form.getByLabel(t('support.start.email')).fill('visitor.support@example.com');
  await form.getByRole('button', { name: t('support.start.submit') }).click();

  await expect(page).toHaveURL(/\/support\/[0-9a-f-]{36}$/);
  const conversation = page.getByTestId('support-conversation');
  await expect(conversation.getByTestId('support-message-customer')).toContainText(
    'Can I pay for my flight in instalments?',
  );
  // The assistant answers from the seeded FAQ, labelled as automated; a person still owes a reply.
  const answer = conversation.getByTestId('support-message-assistant');
  await expect(answer).toContainText('Eligible bookings show the available payment plans', {
    timeout: 10_000,
  });
  await expect(answer).toContainText(t('support.conversation.assistant'));
  await expect(answer).toContainText(t('support.conversation.assistantNote'));
  await expect(conversation.getByTestId('support-status')).toHaveText(t('support.status.open'));
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expectNoAxeViolations(page);

  await conversation.getByLabel(t('support.conversation.reply')).fill('It is for two adults.');
  await conversation.getByRole('button', { name: t('support.conversation.send') }).click();
  await expect(conversation.getByTestId('support-message-customer')).toHaveCount(2);

  await conversation.getByRole('button', { name: t('support.conversation.resolve') }).click();
  await expect(conversation.getByTestId('support-status')).toHaveText(t('support.status.resolved'));
  await expect(conversation).toContainText(t('support.conversation.resolved'));

  // The token lives in this tab only: a fresh tab without it cannot open the conversation.
  const url = page.url();
  const other = await page.context().newPage();
  await other.goto(url);
  await expect(other.getByTestId('support-missing')).toContainText(
    t('support.conversation.notFound'),
  );
  await other.close();
});
