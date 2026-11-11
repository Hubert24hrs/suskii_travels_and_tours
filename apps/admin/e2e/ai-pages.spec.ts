import { adminMessages } from '@suskii/i18n/admin';

import { alertWith, expect, expectNoAxeViolations, expectToast, signIn, t, test } from './fixtures';
import { TRAVELLER_ADDRESS } from './provision';

/**
 * What staff see of the assistant beyond its switches (ADR-105, ADR-106): the knowledge base
 * it answers rules from, its runs with the tools they called, a traveller's conversation with
 * contact details removed, and what it cost. The assistant is the mock inside the API.
 */

const POLICY = [
  '# Refund policy',
  '',
  'How Suskii refunds travellers.',
  '',
  '## Flights cancelled by the airline',
  '',
  'When the airline cancels a flight, everything the traveller paid is refunded.',
  '',
  '## Hotels',
  '',
  "A hotel stay is refunded under the rate's own cancellation terms.",
].join('\n');

const QUESTION = 'What happens when the airline cancels my flight?';

// The same file a second time is a 409 the browser logs before the page says why.
test.use({ allowedConsoleErrors: [/status of 409/] });

test('a super admin adds a document, checks what it answers, limits it to staff and archives it', async ({
  page,
  stack,
}) => {
  await signIn(page, stack, 'knowledgeManager');
  await page.goto('/knowledge');
  await expect(page.getByRole('heading', { level: 1, name: t('knowledge.title') })).toBeVisible();
  await expect(page.getByText(t('knowledge.empty'))).toBeVisible();

  // The file's bytes are the upload; the title starts as the file's name.
  const choose = async () => {
    await page.getByTestId('add-knowledge').click();
    const dialog = page.getByRole('dialog', { name: t('knowledge.add') });
    await dialog.getByTestId('knowledge-file').setInputFiles({
      name: 'refund-policy.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(POLICY, 'utf8'),
    });
    return dialog;
  };
  const add = await choose();
  await expect(add.getByLabel(t('knowledge.title_'))).toHaveValue('refund-policy');
  await add.getByLabel(t('knowledge.title_')).fill('Refund policy');
  await expectNoAxeViolations(page);
  await add.getByRole('button', { name: t('knowledge.addSubmit') }).click();
  await expectToast(page, t('knowledge.added', { count: '3' }));
  const documents = page.getByRole('table', { name: t('knowledge.caption') });
  const row = documents.getByRole('row', { name: /Refund policy/ });
  await expect(row).toContainText(t('knowledge.audiences.customer'));
  await expect(row).toContainText(t('knowledge.languages.en'));

  // The passages are the document's own words under its headings.
  await row
    .getByRole('button', { name: t('knowledge.viewLabel', { name: 'Refund policy' }) })
    .click();
  const passages = page.getByRole('dialog', { name: 'Refund policy' });
  await expect(passages).toContainText('Flights cancelled by the airline');
  await expect(passages).toContainText('everything the traveller paid is refunded');
  await expectNoAxeViolations(page);
  await passages.getByRole('button', { name: t('common.close') }).click();

  // The search the assistant runs finds the passage for a traveller's question.
  await page.getByLabel(t('knowledge.question'), { exact: true }).fill(QUESTION);
  await page.getByTestId('try-knowledge').click();
  const hits = page.getByTestId('knowledge-hits');
  await expect(hits).toContainText('everything the traveller paid is refunded');
  await expect(hits).toContainText('Refund policy');

  // The same file a second time is refused, in words.
  const again = await choose();
  await again.getByLabel(t('knowledge.title_')).fill('Refund policy again');
  await again.getByRole('button', { name: t('knowledge.addSubmit') }).click();
  await expect(alertWith(page, adminMessages.problems['knowledge-duplicate'])).toBeVisible();
  await again.getByRole('button', { name: t('common.close') }).click();

  // Made a staff document, it no longer answers travellers.
  await row
    .getByRole('button', { name: t('knowledge.editLabel', { name: 'Refund policy' }) })
    .click();
  const edit = page.getByRole('dialog', {
    name: t('knowledge.editTitle', { name: 'Refund policy' }),
  });
  await edit.getByLabel(t('knowledge.audience')).selectOption('staff');
  await edit.getByRole('button', { name: t('common.save') }).click();
  await expectToast(page, t('knowledge.saved'));
  await expect(row).toContainText(t('knowledge.audiences.staff'));
  await page.getByTestId('try-knowledge').click();
  await expect(hits).toContainText(t('knowledge.nothingFound'));

  // Archived, it leaves the list in use and can be put back.
  await row
    .getByRole('button', { name: t('knowledge.archiveLabel', { name: 'Refund policy' }) })
    .click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  await expectToast(page, t('knowledge.archivedToast'));
  await expect(page.getByText(t('knowledge.empty'))).toBeVisible();
  await page.getByRole('button', { name: t('knowledge.archived'), exact: true }).click();
  await expect(row).toBeVisible();
  await row
    .getByRole('button', { name: t('knowledge.restoreLabel', { name: 'Refund policy' }) })
    .click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  await expectToast(page, t('knowledge.restoredToast'));
  await expect(page.getByText(t('knowledge.emptyArchived'))).toBeVisible();
  await expectNoAxeViolations(page);
});

test("staff read the assistant's runs, a traveller's conversation without contact details, and its cost", async ({
  page,
  stack,
}) => {
  const { reference } = stack.assistantConversation;
  await signIn(page, stack, 'insightsReader');
  await page.goto('/ai-activity');
  await expect(page.getByRole('heading', { level: 1, name: t('aiActivity.title') })).toBeVisible();

  // The traveller's run: where it came from and how it ended, and what it called.
  await page.getByLabel(t('aiActivity.filterAudience')).selectOption('customer');
  const runs = page.getByRole('table', { name: t('aiActivity.runsCaption') });
  const run = runs.getByRole('row').nth(1);
  await expect(run).toContainText(t('aiActivity.channels.web'));
  await expect(run).toContainText(t('aiActivity.statuses.succeeded'));
  await run.getByRole('button', { name: /^Trace of the run/ }).click();
  const trace = page.getByRole('dialog', { name: t('aiActivity.traceTitle') });
  await expect(trace).toContainText(t('aiActivity.traceNote'));
  await expect(trace).toContainText(t('aiActivity.steps'));
  await expectNoAxeViolations(page);
  await trace.getByRole('button', { name: t('common.close') }).click();

  // Their conversation, as the model saw it: the address they typed is not shown to staff.
  const conversation = page
    .getByRole('table', { name: t('aiActivity.conversationsCaption') })
    .getByRole('row', { name: new RegExp(reference) });
  await conversation
    .getByRole('button', { name: t('aiActivity.openLabel', { reference }) })
    .click();
  const dialog = page.getByRole('dialog', {
    name: t('aiActivity.conversationTitle', { reference }),
  });
  await expect(dialog.getByTestId('monitor-message-user')).toContainText('about my trip to Abuja');
  await expect(dialog.getByTestId('monitor-message-assistant')).toBeVisible();
  await expect(dialog).not.toContainText(TRAVELLER_ADDRESS);
  await expect(dialog).toContainText(t('aiActivity.maskedNote'));
  await expectNoAxeViolations(page);
  await dialog.getByRole('button', { name: t('common.close') }).click();

  // Cost is shown as an estimate with a forecast; quality and the limits beside it.
  await page.goto('/ai-insights');
  await expect(page.getByRole('heading', { level: 1, name: t('aiInsights.title') })).toBeVisible();
  await expect(page.getByText(t('aiInsights.estimate'), { exact: true })).toBeVisible();
  const total = page.getByTestId('cost-total');
  await expect(total).toContainText(t('aiInsights.monthForecast'));
  await expect(total).toContainText(t('aiInsights.capGlobal'));
  await expect(page.getByTestId('quality-total')).toContainText(t('aiInsights.answered'));
  await expect(page.getByRole('heading', { level: 2, name: t('aiInsights.limits') })).toBeVisible();
  await page.getByLabel(t('aiInsights.period')).selectOption('7');
  await expect(total).toContainText(t('aiInsights.estimated'));
  await expectNoAxeViolations(page);
});
