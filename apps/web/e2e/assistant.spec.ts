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

  // How the whole conversation went is one press too, out of five.
  const rating = chat.getByTestId('assistant-rating');
  await expect(rating.getByText(t('assistant.rating.question'))).toBeVisible();
  await rating.getByRole('radio', { name: t('assistant.rating.score', { score: 4 }) }).click();
  await expect(rating.getByText(t('assistant.rating.thanks'))).toBeVisible();
  await expect(
    rating.getByRole('radio', { name: t('assistant.rating.score', { score: 4 }) }),
  ).toHaveAttribute('aria-checked', 'true');
  // What the assistant remembers is for accounts: a visitor is not offered the page.
  await expect(chat.getByTestId('assistant-preferences')).toHaveCount(0);
  await expectNoAxeViolations(page);

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

test.describe('what the assistant remembers (ADR-105)', () => {
  // A code that names no airport is refused with 422 on purpose.
  test.use({ allowedConsoleErrors: [/status of 422/] });

  test('a traveller lets the assistant remember preferences, changes one and erases them all', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // A visitor is told to sign in; nothing is read without a session.
    await page.goto('/assistant/preferences');
    await expect(
      page.getByRole('heading', { level: 1, name: t('assistant.memory.heading') }),
    ).toBeVisible();
    await expect(page.getByText(t('assistant.memory.signIn'))).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expectNoAxeViolations(page);

    await page.goto('/register');
    await page
      .getByTestId('register-email')
      .fill(`web-memory.${Date.now().toString(36)}@example.com`);
    await page.getByTestId('register-password').fill('Sunny-Harbour-Kite-42!');
    await page.getByTestId('register-submit').click();
    await page.waitForURL((url) => url.pathname === '/account');

    // The chat links to it for someone with an account.
    await page.goto('/assistant');
    await page.getByTestId('assistant-preferences').click();
    await page.waitForURL(/\/assistant\/preferences$/);
    const memory = page.getByTestId('assistant-memory');
    // Nothing is remembered until the traveller says so.
    await expect(memory.getByTestId('memory-is-off')).toHaveText(t('assistant.memory.off'));
    await expect(memory.getByTestId('memory-seat')).toHaveCount(0);
    await memory.getByTestId('memory-on').click();
    await expect(memory.getByText(t('assistant.memory.empty'))).toBeVisible();
    await expectNoAxeViolations(page);

    // A choice from a list, and a code the API checks against the catalog.
    const seat = memory.getByTestId('memory-seat');
    await seat
      .getByLabel(t('assistant.memory.keys.seat'))
      .selectOption({ label: t('assistant.memory.seats.window') });
    await seat.getByRole('button', { name: t('assistant.memory.save') }).click();
    await expect(memory.getByTestId('memory-seat-value')).toContainText(
      t('assistant.memory.seats.window'),
    );
    await expect(memory.getByTestId('memory-seat-value')).toContainText(
      t('assistant.memory.setBy.traveller'),
    );
    const airport = memory.getByTestId('memory-home_airport');
    await airport.getByLabel(t('assistant.memory.keys.home_airport')).fill('qqq');
    await airport.getByRole('button', { name: t('assistant.memory.save') }).click();
    await expect(airport.getByRole('alert')).toHaveText(t('assistant.memory.errors.invalid'));
    await airport.getByLabel(t('assistant.memory.keys.home_airport')).fill('los');
    await airport.getByRole('button', { name: t('assistant.memory.save') }).click();
    await expect(memory.getByTestId('memory-home_airport-value')).toContainText('LOS');

    // It is still there on a new visit; one can be erased, and switching off erases the rest.
    await page.reload();
    await expect(memory.getByTestId('memory-seat-value')).toContainText(
      t('assistant.memory.seats.window'),
    );
    await memory
      .getByRole('button', {
        name: t('assistant.memory.eraseLabel', { preference: t('assistant.memory.keys.seat') }),
      })
      .click();
    await expect(memory.getByTestId('memory-seat-value')).toHaveCount(0);
    await expect(memory.getByTestId('memory-home_airport-value')).toContainText('LOS');
    await memory.getByTestId('memory-off').click();
    await expect(memory.getByTestId('memory-is-off')).toBeVisible();
    await memory.getByTestId('memory-on').click();
    await expect(memory.getByTestId('memory-home_airport-value')).toHaveCount(0);
  });
});
