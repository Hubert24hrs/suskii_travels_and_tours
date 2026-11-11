import { expect, expectNoAxeViolations, t, test } from './fixtures';

/**
 * The assistant on the website (ADR-101). The stack runs the mock agent inside the API, so no
 * model is called: a visitor opens the chat from any page, asks, reads the answer, says whether
 * it helped and finds the conversation again in the same tab and on the assistant's own page.
 * What the assistant may do, and that a tap is needed before anything changes, is covered
 * against the API (`agent-*.e2e-spec.ts`).
 */

const QUESTION = 'What documents do I need to fly to Abuja?';

test('a visitor asks the assistant from any page and keeps the conversation in the tab', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/flights');
  // The chat's code is not part of the page: it loads when the button is pressed.
  await page.getByTestId('assistant-open').click();
  const dialog = page.getByRole('dialog', { name: t('assistant.title') });
  await expect(dialog.getByText(t('assistant.disclosure'))).toBeVisible();
  await expect(dialog.getByText(t('assistant.notices.greeting'))).toBeVisible();
  await expect(dialog.getByText(t('assistant.privacy'))).toBeVisible();
  await expectNoAxeViolations(page);

  await dialog.getByLabel(t('assistant.messageLabel')).fill(QUESTION);
  await dialog.getByTestId('assistant-send').click();
  await expect(dialog.getByTestId('assistant-message-user')).toContainText(QUESTION);
  const answer = dialog.getByTestId('assistant-message-assistant');
  await expect(answer).toContainText(/sample assistant/, { timeout: 20_000 });
  await expect(dialog.getByLabel(t('assistant.messageLabel'))).toHaveValue('');
  await expectNoAxeViolations(page);

  // Whether it helped is one press, and is said back.
  await answer.getByRole('button', { name: t('assistant.feedback.up') }).click();
  await expect(answer.getByText(t('assistant.feedback.thanks'))).toBeVisible();

  // A person is always one link away.
  await expect(dialog.getByRole('link', { name: t('assistant.talkToPerson') })).toHaveAttribute(
    'href',
    '/support',
  );

  // The conversation stays with the tab: another page, the same chat.
  await page.goto('/hotels');
  await page.getByTestId('assistant-open').click();
  const reopened = page.getByRole('dialog', { name: t('assistant.title') });
  await expect(reopened.getByTestId('assistant-message-user')).toContainText(QUESTION);
  await expect(reopened.getByTestId('assistant-message-assistant')).toContainText(
    /sample assistant/,
  );

  // Its own page shows the same conversation, is never indexed and has no second button.
  await reopened.getByRole('link', { name: t('assistant.fullPage') }).click();
  await page.waitForURL(/\/assistant$/);
  await expect(page.getByRole('heading', { level: 1, name: t('assistant.title') })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const chat = page.getByTestId('assistant-chat');
  await expect(chat.getByTestId('assistant-message-user')).toContainText(QUESTION);
  await expect(page.getByTestId('assistant-open')).toHaveCount(0);
  await expect(page.getByText(t('assistant.signInForHistory'))).toBeVisible();
  await expectNoAxeViolations(page);

  // Starting again forgets the conversation in this tab; nothing is sent until a message is.
  await chat.getByTestId('assistant-start-again').click();
  await expect(chat.getByTestId('assistant-message-user')).toHaveCount(0);
  await expect(chat.getByText(t('assistant.notices.greeting'))).toBeVisible();
});

test('the assistant is not offered where a payment is made', async ({ page }) => {
  // Any address under /checkout is a payment page, whatever it then shows (ADR-089).
  test.info().annotations.push({ type: 'note', description: 'a missing quote answers 404' });
  await page.goto('/flights');
  await expect(page.getByTestId('assistant-open')).toBeVisible();
  await page.goto('/checkout/00000000-0000-7000-8000-000000000000');
  await expect(page.getByTestId('assistant-open')).toHaveCount(0);
});
