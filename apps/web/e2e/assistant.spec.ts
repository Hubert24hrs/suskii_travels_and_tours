import { expect, expectNoAxeViolations, t, test } from './fixtures';

/**
 * The assistant on the website (ADR-101). The stack runs the mock agent inside the API, so no
 * model is called: a visitor follows the link in the top bar to the assistant's page, asks,
 * reads the answer, says whether it helped and finds the conversation again in the same tab.
 * What the assistant may do, and that a tap is needed before anything changes, is covered
 * against the API (`agent-*.e2e-spec.ts`).
 */

const QUESTION = 'What documents do I need to fly to Abuja?';
/** `E2E_AGENT=off` starts the stack without the assistant, as production is until switched on. */
const OFF = process.env.E2E_AGENT === 'off';
const WHY = 'the assistant is switched off in this run';

test.describe('with the assistant switched off', () => {
  test.skip(!OFF, 'the assistant is on in this run');
  // Its pages answer 404 on purpose.
  test.use({ allowedConsoleErrors: [/status of 404/] });

  test('no page offers it, its pages do not exist, and search still works', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/flights');
    await expect(page.getByTestId('assistant-open')).toHaveCount(0);
    await expect(page.getByRole('link', { name: t('assistant.open') })).toHaveCount(0);
    // The search form is there as always: nothing of it waits for the assistant.
    await expect(page.getByRole('button', { name: t('search.flights.submit') })).toBeVisible();

    for (const path of ['/assistant', '/assistant/preferences']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });
});

test('Ask Suskii is one button that changes place, can be put away and keeps off some pages', async ({
  page,
}) => {
  test.skip(OFF, WHY);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/flights');
  // One button on the page, named as the owner asked, and a plain link (ADR-109).
  const button = page.getByTestId('assistant-open');
  await expect(button).toHaveCount(1);
  await expect(button).toBeVisible();
  await expect(button).toHaveText(t('assistant.open'));
  await expect(button).toHaveAttribute('href', '/assistant');
  expect(t('assistant.open')).toBe('Ask Suskii');
  await expect(
    page
      .getByRole('navigation', { name: t('header.utilityNav') })
      .getByRole('link', { name: t('assistant.open') }),
  ).toHaveCount(0);

  // It begins in one of its four places and does not stay there.
  const holder = page.locator('[data-ask-suskii]');
  expect(['0', '1', '2', '3']).toContain(await holder.getAttribute('data-start'));
  const first = await holder.boundingBox();
  await expect
    .poll(
      async () => {
        const now = await holder.boundingBox();
        return first && now ? Math.abs(now.x - first.x) + Math.abs(now.y - first.y) : 0;
      },
      { timeout: 25_000 },
    )
    .toBeGreaterThan(100);
  // Wherever it is, all of it is on the page.
  const box = await holder.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 1280 && box.y >= 0).toBe(true);

  // Someone who asked for less motion gets a button that stays where the visit began.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(holder).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // While someone types it steps aside, and comes back when they are done.
  const field = page.locator('main input[type="text"], main input[role="combobox"]').first();
  await field.focus();
  await expect(button).toBeHidden();
  await field.blur();
  await expect(button).toBeVisible();

  // What moves can be put away (WCAG 2.2.2), without any script.
  await page.locator('label[for="ask-suskii-hide"]').click();
  await expect(button).toBeHidden();
  await expect(page.getByTestId('ask-suskii-hide')).toBeChecked();

  // A fresh page shows it again; the sign-in form and the assistant's own page never do.
  await page.goto('/hotels');
  await expect(page.getByTestId('assistant-open')).toBeVisible();
  for (const path of ['/sign-in', '/assistant']) {
    await page.goto(path);
    await expect(page.getByTestId('assistant-open'), path).toBeHidden();
  }
});

test('a visitor asks the assistant and keeps the conversation in the tab', async ({ page }) => {
  test.skip(OFF, WHY);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/flights');
  // The entry is a link: no page but the assistant's own carries any of its code.
  await page.getByTestId('assistant-open').click();
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

test('an answer is read with its note, in words, whatever the assistant wrote', async ({
  page,
}) => {
  test.skip(OFF, WHY);
  await page.goto('/assistant');
  const chat = page.getByTestId('assistant-chat');
  await chat.getByLabel(t('assistant.messageLabel')).fill(QUESTION);
  await chat.getByTestId('assistant-send').click();
  const answer = chat.getByTestId('assistant-message-assistant');
  await expect(answer).toContainText(/sample assistant/, { timeout: 20_000 });

  // The stored answer as a fare tool leaves it (ADR-107): a link, a note as a code, and a
  // note this build has no words for. The sample assistant calls no such tool, so the cards
  // are put on the API's own answer on its way to the page.
  await page.route('**/v1/agent/conversations/*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const body = (await response.json()) as {
      messages: { role: string; kind: string; cards: unknown[] }[];
    };
    for (const message of body.messages) {
      if (message.role !== 'assistant' || message.kind !== 'text') continue;
      message.cards = [
        { kind: 'link', title: 'LOS → LHR', lines: [], href: '/flights/lagos-to-london' },
        { kind: 'note', title: 'fare_trend', lines: [] },
        { kind: 'note', title: 'a_note_from_a_newer_server', lines: [] },
      ];
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto('/assistant');

  const notes = chat.getByTestId('assistant-notes');
  await expect(notes.getByText(t('assistant.notes.label'))).toBeVisible();
  await expect(chat.getByTestId('assistant-note-fare_trend')).toHaveText(
    t('assistant.notes.fare_trend'),
  );
  // A code is never shown as words, and a note is not drawn as a result card.
  await expect(chat.getByText('fare_trend')).toHaveCount(0);
  await expect(chat.getByText('a_note_from_a_newer_server')).toHaveCount(0);
  await expect(answer.getByRole('listitem')).toHaveCount(1);
  await expect(answer.getByRole('link', { name: t('assistant.cards.view') })).toHaveAttribute(
    'href',
    '/flights/lagos-to-london',
  );
  await expectNoAxeViolations(page);
});

test.describe('the two limits', () => {
  // The day's spend cap is answered with 429 on purpose.
  test.use({ allowedConsoleErrors: [/status of 429/] });

  test("a run that used its steps and the day's spend cap say different things", async ({
    page,
  }) => {
    test.skip(OFF, WHY);
    await page.goto('/assistant');
    const chat = page.getByTestId('assistant-chat');
    await chat.getByLabel(t('assistant.messageLabel')).fill(QUESTION);
    await chat.getByTestId('assistant-send').click();
    const answer = chat.getByTestId('assistant-message-assistant');
    await expect(answer).toContainText(/sample assistant/, { timeout: 20_000 });

    // A run that used its steps or tool calls ends in the `limit` notice. The sample assistant
    // never runs out, so its stored answer becomes that notice on the way to the page.
    await page.route('**/v1/agent/conversations/*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const body = (await response.json()) as {
        messages: { role: string; kind: string; text: string; notice: string | null }[];
      };
      for (const message of body.messages) {
        if (message.role !== 'assistant') continue;
        Object.assign(message, { kind: 'notice', text: '', notice: 'limit', cards: [] });
      }
      await route.fulfill({ response, json: body });
    });
    // The day's spend cap refuses the next message before a run starts.
    await page.route('**/v1/agent/chat', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/problem+json',
        json: {
          type: 'urn:suskii:problem:agent-budget',
          title: "The assistant has reached today's limit",
          status: 429,
        },
      }),
    );
    await page.goto('/assistant');

    // The run's notice asks for one thing at a time and says nothing about the day.
    await expect(answer).toContainText(t('assistant.notices.limit'));
    await expect(chat.getByText(t('assistant.errors.budget'))).toHaveCount(0);

    await chat.getByLabel(t('assistant.messageLabel')).fill('And a hotel in Abuja?');
    await chat.getByTestId('assistant-send').click();
    await expect(chat.getByText(t('assistant.errors.budget'))).toBeVisible();
    await expect(answer).toHaveCount(1);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test('a price seen on another site is marked indicative, with where and when it was seen', async ({
  page,
}) => {
  test.skip(OFF, WHY);
  await page.goto('/assistant');
  const chat = page.getByTestId('assistant-chat');
  await chat.getByLabel(t('assistant.messageLabel')).fill(QUESTION);
  await chat.getByTestId('assistant-send').click();
  const answer = chat.getByTestId('assistant-message-assistant');
  await expect(answer).toContainText(/sample assistant/, { timeout: 20_000 });

  // The card as `prices.indicative` builds it (ADR-102, ADR-104): the thing priced, the site
  // and the time it was seen there, the price and the mark. No site is approved on this
  // stack, so the card is put on the API's own answer on its way to the page.
  const seen = 'rooms.example.com, 2026-11-11 09:30 UTC';
  await page.route('**/v1/agent/conversations/*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const body = (await response.json()) as {
      messages: { role: string; kind: string; cards: unknown[] }[];
    };
    for (const message of body.messages) {
      if (message.role !== 'assistant' || message.kind !== 'text') continue;
      message.cards = [
        {
          kind: 'price',
          title: 'Harbour View Hotel',
          lines: [seen],
          price: { amountMinor: 8_500_000, currency: 'NGN' },
          indicative: true,
        },
        { kind: 'link', title: 'LOS → LHR', lines: [], href: '/flights/lagos-to-london' },
      ];
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto('/assistant');

  const cards = answer.getByRole('listitem');
  await expect(cards).toHaveCount(2);
  const price = cards.filter({ hasText: 'Harbour View Hotel' });
  await expect(price.getByText(t('assistant.cards.indicative'), { exact: true })).toBeVisible();
  await expect(price.getByText(t('assistant.cards.indicativeNote'))).toBeVisible();
  await expect(price.getByText(seen)).toBeVisible();
  await expect(price).toContainText('85,000');
  // An indicative price leads nowhere to book, and a price of ours carries no such mark.
  await expect(price.getByRole('link')).toHaveCount(0);
  const ours = cards.filter({ hasText: 'LOS → LHR' });
  await expect(ours.getByText(t('assistant.cards.indicative'), { exact: true })).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test('the menu on a phone leads to the assistant too', async ({ page }) => {
  test.skip(OFF, WHY);
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
  test.skip(OFF, WHY);
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
