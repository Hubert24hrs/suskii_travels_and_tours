import { API_URL } from './stack';
import { expect, expectNoAxeViolations, expectToast, signIn, t, test } from './fixtures';

interface Started {
  conversation: { id: string; reference: string };
  accessToken: string;
}

/** A visitor's conversation, started through the API as the website would. */
async function visitorConversation(): Promise<Started> {
  const response = await fetch(`${API_URL}/v1/support/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Suskii-Client': 'web/e2e' },
    body: JSON.stringify({
      category: 'payment',
      message: 'My card was charged twice, can you check?',
      email: 'charged.twice@example.com',
      turnstileToken: 'e2e',
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Started;
}

/**
 * The support inbox (ADR-083): a conversation waits in the active queue with its due time; an
 * agent adds an internal note, replies and raises the priority. The traveller sees the reply and
 * never the note.
 */
test('an agent answers a visitor from the support inbox', async ({ page, stack }) => {
  const started = await visitorConversation();
  const { reference, id } = started.conversation;

  await signIn(page, stack, 'supportAgent');
  await page.goto('/support');
  await expect(page.getByRole('heading', { level: 1, name: t('support.title') })).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(reference) });
  await expect(row).toContainText(t('support.statuses.open'));
  await expect(row).toContainText(t('support.awaitingReply'));
  await expectNoAxeViolations(page);

  await row.getByRole('link', { name: t('support.openFor', { reference }) }).click();
  await expect(page.getByTestId('support-customer')).toContainText('My card was charged twice');

  const message = page.getByLabel(t('support.message'));
  await message.fill('Two charges on the statement, one is a hold.');
  await page.getByLabel(t('support.internalToggle')).check();
  await page.getByRole('button', { name: t('support.send') }).click();
  await expectToast(page, t('support.noted'));
  await expect(page.getByTestId('support-note')).toContainText('one is a hold');

  await message.fill('One of the two charges is a hold your bank releases within 5 days.');
  await page.getByRole('button', { name: t('support.send') }).click();
  await expectToast(page, t('support.replied'));
  await expect(page.getByTestId('support-staff')).toContainText('releases within 5 days');
  await expect(page.getByLabel(t('support.status'))).toHaveValue('waiting');

  await page.getByLabel(t('support.priority')).selectOption('urgent');
  await expectToast(page, t('support.updated'));
  await expectNoAxeViolations(page);

  // The traveller sees the reply, not the note.
  const seen = await fetch(`${API_URL}/v1/support/conversations/${id}`, {
    headers: { 'X-Support-Token': started.accessToken },
  });
  const body = (await seen.json()) as { messages: { author: string; text: string }[] };
  expect(body.messages.map((entry) => entry.author)).toEqual(['customer', 'staff']);
  expect(JSON.stringify(body)).not.toContain('one is a hold');
});
