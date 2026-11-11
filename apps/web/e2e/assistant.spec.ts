import { expect, expectNoAxeViolations, t, test } from './fixtures';

/**
 * The assistant on the website (ADR-101). The stack runs the mock agent inside the API, so no
 * model is called: a visitor follows the link in the top bar to the assistant's page, asks,
 * reads the answer, says whether it helped and finds the conversation again in the same tab.
 * What the assistant may do, and that a tap is needed before anything changes, is covered
 * against the API (`agent-*.e2e-spec.ts`).
 */

const QUESTION = 'What documents do I need to fly to Abuja?';

test('a visitor asks the assistant and keeps the conversation in the tab', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/flights');
  // The entry is a link: no page but the assistant's own carries any of its code.
  await page
    .getByRole('navigation', { name: t('header.utilityNav') })
    .getByRole('link', { name: t('assistant.open') })
    .click();
  await page.waitForURL(/\/assistant$/);
  await expect(page.getByRole('heading', { level: 1, name: t('assistant.title') })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const chat = page.getByTestId('assistant-chat');
  await expect(chat.getByText(t('assistant.disclosure'))).toBeVisible();
  await expect(chat.getByText(t('assistant.notices.greeting'))).toBeVisible();
  await expect(chat.getByText(t('assistant.privacy'))).toBeVisible();
  await expect(page.getByText(t('assistant.signInForHistory'))).toBeVisible();
  await expectNoAxeViolations(page);

  await chat.getByLabel(t('assistant.messageLabel')).fill(QUESTION);
  await chat.getByTestId('assistant-send').click();
  await expect(chat.getByTestId('assistant-message-user')).toContainText(QUESTION);
  const answer = chat.getByTestId('assistant-message-assistant');
  await expect(answer).toContainText(/sample assistant/, { timeout: 20_000 });
  await expect(chat.getByLabel(t('assistant.messageLabel'))).toHaveValue('');
  await expectNoAxeViolations(page);

  // Whether it helped is one press, and is said back.
  await answer.getByRole('button', { name: t('assistant.feedback.up') }).click();
  await expect(answer.getByText(t('assistant.feedback.thanks'))).toBeVisible();

  // A person is always one link away.
  await expect(chat.getByRole('link', { name: t('assistant.talkToPerson') })).toHaveAttribute(
    'href',
    '/support',
  );

  // The conversation stays with the tab: away and back, the same chat.
  await page.goto('/hotels');
  await page.getByTestId('assistant-open').click();
  await page.waitForURL(/\/assistant$/);
  await expect(chat.getByTestId('assistant-message-user')).toContainText(QUESTION);
  await expect(chat.getByTestId('assistant-message-assistant')).toContainText(/sample assistant/);

  // Starting again forgets the conversation in this tab; nothing is sent until a message is.
  await chat.getByTestId('assistant-start-again').click();
  await expect(chat.getByTestId('assistant-message-user')).toHaveCount(0);
  await expect(chat.getByText(t('assistant.notices.greeting'))).toBeVisible();
});

test('the menu on a phone leads to the assistant too', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: t('header.openMenu') }).click();
  await page
    .getByRole('dialog', { name: t('header.menuTitle') })
    .getByRole('link', { name: t('assistant.open') })
    .click();
  await page.waitForURL(/\/assistant$/);
  await expect(page.getByTestId('assistant-chat')).toBeVisible();
  await expectNoAxeViolations(page);
});
