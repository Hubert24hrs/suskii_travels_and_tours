import { randomUUID } from 'node:crypto';

import { adminMessages } from '@suskii/i18n/admin';

import {
  expect,
  expectNoAxeViolations,
  expectToast,
  expireStepUp,
  signIn,
  t,
  test,
} from './fixtures';
import type { Persona } from './personas';
import { API_URL } from './stack';
import { totp } from './totp';

/**
 * The assistant in the console (ADR-102, ADR-104, ADR-107): its switches, the staff chat, the
 * approvals queue, assisted quotes and the sites prices are read from. The assistant here is
 * the mock inside the API: no model and no vendor is called.
 */

// The pause is one switch for everyone, so the journeys that need the assistant answering
// run one after the other.
test.describe.configure({ mode: 'serial' });
// A refused step-up is a 403 the browser logs before the console asks for a code.
test.use({ allowedConsoleErrors: [/status of 40[13]/] });

interface PublicStatus {
  enabled: boolean;
  paused: boolean;
  available: boolean;
}

const assistantStatus = async (): Promise<PublicStatus> =>
  (await (await fetch(`${API_URL}/v1/agent/status`)).json()) as PublicStatus;

/** A call to the API as a traveller would make it from the website or the app. */
async function api<T>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

const ADULT = { type: 'adult', surname: 'Eze', dateOfBirth: '1990-04-01', nationality: 'NG' };

const travellerToken = async (traveller: Persona): Promise<string> =>
  (
    await api<{ accessToken: string }>('POST', '/v1/auth/login', {
      body: { email: traveller.email, password: traveller.password },
    })
  ).accessToken;

test('a super admin pauses the assistant, releases it with a fresh code and sets a level', async ({
  page,
  stack,
}) => {
  const secret = stack.personas.aiManager.secret ?? '';
  await signIn(page, stack, 'aiManager');
  await page.goto('/ai');
  await expect(page.getByRole('heading', { level: 1, name: t('ai.title') })).toBeVisible();
  const state = page.getByTestId('assistant-state');
  await expect(state).toContainText(t('ai.on'));
  await expect(state).toContainText(t('ai.running'));
  expect(await assistantStatus()).toMatchObject({ paused: false, available: true });

  // Pausing is one press with a reason: no code is asked for in an incident.
  await page.getByTestId('pause-assistant').click();
  const pause = page.getByRole('dialog', { name: t('ai.pause') });
  await pause.getByLabel(t('ai.pauseReason')).selectOption('quality');
  await expectNoAxeViolations(page);
  await pause.getByRole('button', { name: t('ai.pauseSubmit') }).click();
  await expectToast(page, t('ai.pausedToast'));
  await expect(state).toContainText(t('ai.paused'));
  // (A group with an `other` entry is typed as a plural, so its entries are read directly.)
  await expect(page.getByText(adminMessages.ai.pauseReasons.quality)).toBeVisible();
  expect(await assistantStatus()).toMatchObject({ paused: true, available: false });

  // Releasing it asks for a fresh authenticator code once the sign-in's check is old.
  await expireStepUp(stack, 'aiManager');
  await page.getByRole('button', { name: t('ai.release') }).click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  const prompt = page.getByRole('dialog', { name: t('auth.stepUp.heading') });
  await expect(prompt).toBeVisible();
  await prompt.getByTestId('step-up-code').fill(totp(secret));
  await prompt.getByRole('button', { name: t('auth.stepUp.submit') }).click();
  await expectToast(page, t('ai.releasedToast'));
  await expect(state).toContainText(t('ai.running'));
  expect(await assistantStatus()).toMatchObject({ paused: false, available: true });

  // An agent set to advice only prepares nothing; the level shows who set it.
  const marketing = page
    .getByRole('table', { name: t('ai.autonomyCaption') })
    .getByRole('row', { name: new RegExp(t('ai.agents.marketing')) });
  await expect(marketing).toContainText(t('ai.levels.supervised'));
  await expect(marketing).toContainText(t('ai.levelDefault'));
  await page.getByTestId('level-agent-marketing').click();
  const level = page.getByRole('dialog', {
    name: t('ai.changeLevelTitle', { name: t('ai.agents.marketing') }),
  });
  await level.getByLabel(t('ai.level')).selectOption('manual');
  await level.getByRole('button', { name: t('common.save') }).click();
  await expectToast(page, t('ai.levelSaved'));
  await expect(marketing).toContainText(t('ai.levels.manual'));
  await expect(marketing).toContainText(t('ai.levelSet'));

  // Every tool is listed with what it may do; none of the staff tools commits.
  const tools = page.getByRole('table', { name: t('ai.toolsCaption') });
  await expect(tools.getByRole('row', { name: /finance\.draft_refund_request/ })).toContainText(
    t('ai.tiers.propose'),
  );
  await expect(tools.getByRole('row', { name: /bookings\.cancel/ })).toContainText(
    t('ai.tiers.commit'),
  );

  // One agent is switched off and on again; the general agent has no switch.
  const autonomy = page.getByRole('table', { name: t('ai.autonomyCaption') });
  const hotels = autonomy.getByRole('row', { name: new RegExp(t('ai.agents.hotels')) });
  const switchName = (action: string) =>
    t('ai.switchLabel', { action, name: t('ai.agents.hotels') });
  await expect(hotels.getByText(t('ai.agentOn'), { exact: true })).toBeVisible();
  const concierge = autonomy.getByRole('row', { name: new RegExp(t('ai.agents.concierge')) });
  await expect(concierge).toContainText(t('ai.alwaysOn'));
  await expect(concierge.getByRole('button', { name: /Switch/ })).toHaveCount(0);
  await hotels.getByRole('button', { name: switchName(t('ai.switchOff')) }).click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  await expect(hotels.getByText(t('ai.agentOff'), { exact: true })).toBeVisible();
  await hotels.getByRole('button', { name: switchName(t('ai.switchOn')) }).click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  await expect(hotels.getByText(t('ai.agentOn'), { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);

  // The audit log, narrowed to the assistant, names what was just done.
  await page.getByRole('link', { name: t('ai.openAudit') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('audit.title') })).toBeVisible();
  await expect(page.getByLabel(t('audit.filterArea'))).toHaveValue('assistant');
  const log = page.getByRole('table', { name: t('audit.title') });
  await expect(log).toContainText('agent.agent_switched');
  await expect(log).toContainText('agent.autonomy_changed');
  await expect(log).toContainText('agent.resumed');
});

test('staff ask the assistant, and what it prepared for them is someone else to decide', async ({
  page,
  stack,
}) => {
  await signIn(page, stack, 'assistantAsker');
  await page.goto('/assistant');
  await expect(page.getByRole('heading', { level: 1, name: t('assistant.title') })).toBeVisible();
  await expect(page.getByText(t('assistant.empty'))).toBeVisible();

  // The page reads the new conversation as soon as it exists, while the message is still being
  // sent. That read reaches the API first and its answer comes back after the send's: the
  // answer must still appear. (It once stopped the page waiting, and the answer never showed.)
  let readArrived!: () => void;
  const earlierRead = new Promise<void>((resolve) => {
    readArrived = resolve;
  });
  let releaseEarlierRead!: () => void;
  const sendTaken = new Promise<void>((resolve) => {
    releaseEarlierRead = resolve;
  });
  let held = false;
  await page.route(/\/v1\/admin\/ai\/conversations\/[0-9a-f-]{36}$/, async (route) => {
    if (held || route.request().method() !== 'GET') return route.fallback();
    held = true;
    const response = await route.fetch();
    readArrived();
    await sendTaken;
    // The page may have dropped this read by now, which is what it should do.
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.route('**/v1/admin/ai/chat', async (route) => {
    await earlierRead;
    await route.fallback();
  });

  await page.getByLabel(t('assistant.message')).fill('What is waiting for a person today?');
  await page.getByRole('button', { name: t('assistant.send') }).click();
  // The box empties once the page has the send's answer; only then does the earlier read land.
  await expect(page.getByLabel(t('assistant.message'))).toHaveValue('');
  releaseEarlierRead();

  const log = page.getByRole('log', { name: t('assistant.conversation') });
  await expect(log.getByTestId('message-user')).toContainText('What is waiting for a person');
  // Operations reach the operations assistant first; the mock says its one sentence.
  const answer = log.getByTestId('message-assistant');
  await expect(answer).toContainText(/sample assistant/);
  await expect(answer).toContainText(t('ai.agents.operations'));
  await expect(page.getByLabel(t('assistant.message'))).toHaveValue('');
  await expectNoAxeViolations(page);

  // A promo code the assistant prepared for this person: they see it and cannot decide it.
  await page.getByRole('link', { name: t('assistant.openApprovals') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('approvals.title') })).toBeVisible();
  const proposal = page.getByRole('region', { name: t('approvals.kinds.promo_code') });
  await expect(proposal).toContainText(stack.approval.code);
  await expect(proposal).toContainText(t('approvals.askedByYou'));
  await expect(proposal).toContainText(t('approvals.ownNote'));
  await expect(proposal.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
  await expect(proposal.getByRole('button', { name: /^Reject/ })).toHaveCount(0);
  // And a recipe for a site whose pages stopped reading: what would be saved, and that a
  // rule worked it out from the kept page.
  const recipe = page.getByRole('region', { name: t('approvals.kinds.source_recipe') });
  await expect(recipe).toContainText(stack.recipeApproval.version);
  await expect(recipe).toContainText('structured_data (Product, Hotel)');
  await expect(recipe).toContainText(t('approvals.recipeItemsRead'));
  await expect(recipe).toContainText(t('approvals.recipeNote'));
  await expect(recipe).toContainText(t('approvals.ownNote'));
  await expect(recipe.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test('another staff member approves the proposal, and the promo code is created switched off', async ({
  page,
  stack,
}) => {
  await signIn(page, stack, 'approvalDecider');
  await page.goto('/approvals');
  const proposal = page.getByRole('region', { name: t('approvals.kinds.promo_code') });
  await expect(proposal).toContainText(stack.approval.code);
  await expect(proposal).toContainText(t('approvals.percentOff', { percent: '10' }));
  await expect(page.getByText(t('approvals.quotesToVerify', { count: 1 }))).toBeVisible();
  // Someone else's recipe for a site is theirs to read, and not to decide: operations may
  // not change a site themselves.
  const recipe = page.getByRole('region', { name: t('approvals.kinds.source_recipe') });
  await expect(recipe).toContainText(t('approvals.noPermissionNote'));
  await expect(recipe.getByRole('button', { name: /^Approve/ })).toHaveCount(0);

  await proposal.getByRole('button', { name: /^Approve/ }).click();
  const confirm = page.getByRole('dialog', { name: t('approvals.approve') });
  await expect(confirm).toContainText(t('approvals.approvePromoQuestion'));
  await expectNoAxeViolations(page);
  await confirm.getByRole('button', { name: t('common.yes') }).click();
  await expectToast(page, t('approvals.approved'));
  // It leaves the queue; among the approved ones it names what was created.
  await expect(proposal).toHaveCount(0);
  await page.getByLabel(t('approvals.filter')).selectOption('approved');
  const decided = page.getByRole('region', { name: t('approvals.kinds.promo_code') });
  await expect(decided).toContainText(t('approvals.resultPromo'));
  await decided.getByRole('link', { name: t('approvals.seePromos') }).click();

  // The code exists and is switched off: switching it on is a person's separate step.
  await expect(page.getByRole('heading', { level: 1, name: t('promos.title') })).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(stack.approval.code) });
  await expect(row).toContainText(t('common.inactive'));
});

test('an assisted quote is verified by staff, paid by the traveller and booked by hand', async ({
  page,
  stack,
}) => {
  const { id, reference } = stack.assistedQuote;
  await signIn(page, stack, 'quoteDesk');
  await page.goto('/assisted-quotes');
  await expect(
    page.getByRole('heading', { level: 1, name: t('assistedQuotes.title') }),
  ).toBeVisible();
  const card = page.getByRole('region', { name: new RegExp(reference) });
  await expect(card).toContainText(t('assistedQuotes.statuses.requested'));
  await expect(card).toContainText(t('assistedQuotes.adults', { count: 2 }));

  // Staff record the price the supplier charges today, and where the proof is kept.
  await page.getByTestId(`verify-${reference}`).click();
  const verify = page.getByRole('dialog', { name: t('assistedQuotes.verifyTitle', { reference }) });
  await verify
    .getByLabel(t('assistedQuotes.supplierName'), { exact: true })
    .fill('Lagoon Wholesale');
  await verify.getByLabel(t('assistedQuotes.supplierAmount')).fill('300000');
  await verify
    .getByLabel(t('assistedQuotes.evidenceUrl'))
    .fill('https://files.suskii.test/quotes/lagoon-price.pdf');
  await verify
    .getByLabel(t('assistedQuotes.offerSummary'))
    .fill('Three nights for two with breakfast. Free cancellation until five days before.');
  await verify.getByLabel(t('assistedQuotes.refundable')).check();
  await expectNoAxeViolations(page);
  await verify.getByRole('button', { name: t('assistedQuotes.verifySubmit') }).click();
  await expectToast(page, t('assistedQuotes.offered'));

  // It is no longer waiting for a price; nothing waits to be booked before it is paid.
  await expect(card).toHaveCount(0);
  await page.getByLabel(t('assistedQuotes.queue')).selectOption('to_book');
  await expect(page.getByText(t('assistedQuotes.empty'))).toBeVisible();

  // The traveller books the offer and pays it like any other booking.
  const token = await travellerToken(stack.personas.quoteTraveller);
  const quote = await api<{ offer: { quoteId: string } }>('GET', `/v1/quotes/assisted/${id}`, {
    token,
  });
  const offer = await api<{ termsVersion: string }>('GET', `/v1/quotes/${quote.offer.quoteId}`, {
    token,
  });
  const created = await api<{ booking: { id: string } }>('POST', '/v1/bookings', {
    token,
    headers: { 'Idempotency-Key': randomUUID() },
    body: {
      quoteId: quote.offer.quoteId,
      contact: { email: stack.personas.quoteTraveller.email, phone: '+2348012345678' },
      // The request was for two adults: both are named on the booking, not on the quote.
      passengers: [
        { ...ADULT, givenNames: 'Ngozi', gender: 'f', title: 'ms' },
        { ...ADULT, givenNames: 'Chidi', gender: 'm', title: 'mr' },
      ],
      termsVersion: offer.termsVersion,
      acceptTerms: true,
    },
  });
  const bookingId = created.booking.id;
  const payment = await api<{ checkoutUrl: string }>('POST', `/v1/bookings/${bookingId}/payments`, {
    token,
    headers: { 'Idempotency-Key': randomUUID() },
    body: {},
  });
  const paymentReference = new URL(payment.checkoutUrl).pathname.split('/').at(-1) ?? '';
  await api('POST', `/v1/payments/mock/${paymentReference}/complete`, {
    body: { outcome: 'succeeded' },
  });
  // Paid is not confirmed: the booking waits for a person.
  await expect
    .poll(
      async () =>
        (await api<{ status: string }>('GET', `/v1/bookings/${bookingId}`, { token })).status,
    )
    .toBe('TICKETING');

  // Staff book it with the supplier and record the confirmation: only that confirms it.
  await page.reload();
  await page.getByLabel(t('assistedQuotes.queue')).selectOption('to_book');
  const paid = page.getByRole('region', { name: new RegExp(reference) });
  await expect(paid).toContainText(t('assistedQuotes.queues.to_book'));
  await page.getByTestId(`booked-${reference}`).click();
  const booked = page.getByRole('dialog', {
    name: t('assistedQuotes.markBookedTitle', { reference }),
  });
  await booked.getByLabel(t('assistedQuotes.supplierReferenceField')).fill('LGN-48213');
  await booked
    .getByLabel(t('assistedQuotes.evidenceUrl'))
    .fill('https://files.suskii.test/quotes/lagoon-confirmation.pdf');
  await booked.getByRole('button', { name: t('assistedQuotes.markBookedSubmit') }).click();
  await expectToast(page, t('assistedQuotes.booked'));
  await expect(page.getByText(t('assistedQuotes.empty'))).toBeVisible();
  await expect
    .poll(
      async () =>
        (await api<{ status: string }>('GET', `/v1/bookings/${bookingId}`, { token })).status,
    )
    .toBe('CONFIRMED');
  await expectNoAxeViolations(page);
});

test('a super admin lists a site, approves it with a basis, reads it and switches it off', async ({
  page,
  stack,
}) => {
  const domain = 'e2e-hotels.example.com';
  await signIn(page, stack, 'sourceManager');
  await page.goto('/data-sources');
  await expect(page.getByRole('heading', { level: 1, name: t('dataSources.title') })).toBeVisible();

  // A new site starts in review, where only the mock reads it.
  await page.getByTestId('add-site').click();
  const add = page.getByRole('dialog', { name: t('dataSources.addSiteTitle') });
  await add.getByLabel(t('dataSources.domain'), { exact: true }).fill(domain);
  await add.getByLabel(t('dataSources.name'), { exact: true }).fill('E2E Hotels');
  await add.getByLabel(t('dataSources.vendorsField')).fill('mock');
  await add.getByLabel(t('dataSources.robots')).selectOption('allowed');
  await add.getByLabel(t('dataSources.terms')).selectOption('silent');
  await add
    .getByLabel(t('dataSources.urlTemplates'))
    .fill(JSON.stringify({ hotel: `https://${domain}/search?city={place}&in={from}` }));
  await expectNoAxeViolations(page);
  await add.getByRole('button', { name: t('dataSources.saveSite') }).click();
  await expectToast(page, t('dataSources.siteSaved'));
  const site = page.getByRole('region', { name: 'E2E Hotels' });
  await expect(site).toContainText(t('dataSources.statuses.review'));
  await expect(site).toContainText(t('dataSources.readable.review_mock_only'));

  // Approval states the basis and where it is written down.
  await page.getByTestId(`approve-site-${domain}`).click();
  const approve = page.getByRole('dialog', {
    name: t('dataSources.approveTitle', { name: 'E2E Hotels' }),
  });
  await approve.getByLabel(t('dataSources.basis')).selectOption('public_data_assessment');
  await approve.getByLabel(t('dataSources.basisReference')).fill('Legal file PI-2026-021');
  await approve.getByRole('button', { name: t('dataSources.approveSubmit') }).click();
  await expectToast(page, t('dataSources.approved'));
  await expect(site).toContainText(t('dataSources.statuses.approved'));
  await expect(site).toContainText('Legal file PI-2026-021');

  // One read through the site's policy shows prices marked as read from this site.
  await page.getByTestId(`read-site-${domain}`).click();
  const read = page.getByRole('dialog', {
    name: t('dataSources.readTitle', { name: 'E2E Hotels' }),
  });
  await read.getByLabel(t('dataSources.readPlace')).fill('Lagos');
  await read
    .getByLabel(t('dataSources.readFrom'))
    .fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await read.getByRole('button', { name: t('dataSources.readSubmit') }).click();
  const result = read.getByTestId('read-result');
  await expect(result).toContainText(t('dataSources.readStates.read'));
  await expect(
    result.getByRole('table', { name: t('dataSources.observationsCaption') }).getByRole('row'),
  ).not.toHaveCount(1);
  await read.getByRole('button', { name: t('common.close') }).click();
  await expect(
    page
      .getByRole('table', { name: t('dataSources.jobsCaption') })
      .getByRole('row', { name: new RegExp(domain) })
      .first(),
  ).toContainText(t('dataSources.jobStatuses.succeeded'));

  // How reading has gone: the one try gave a usable page, and the mock is not being skipped.
  const health = page.getByTestId('source-health');
  await expect(
    health
      .getByRole('table', { name: t('dataSources.healthSitesCaption') })
      .getByRole('row', { name: new RegExp(domain) }),
  ).toContainText('1 (100%)');
  await expect(
    health
      .getByRole('table', { name: t('dataSources.healthVendorsCaption') })
      .getByRole('row', { name: new RegExp(t('dataSources.vendorNames.mock')) }),
  ).toContainText(t('dataSources.breakerClosed'));

  // Switching a site off takes effect at once; switching it back on is a second decision.
  await page.getByTestId('stop-reading').click();
  const stop = page.getByRole('dialog', { name: t('dataSources.stopTitle') });
  await stop.getByLabel(t('dataSources.stopScope')).selectOption('domain');
  await stop.getByLabel(t('dataSources.stopSubject')).fill(domain);
  await stop.getByRole('button', { name: t('dataSources.stopSubmit') }).click();
  await expectToast(page, t('dataSources.stopped'));
  const switches = page.getByTestId('switches');
  await expect(switches).toContainText(domain);
  await expect(site).toContainText(t('dataSources.readable.switched_off'));
  await switches.getByRole('button', { name: /^Switch back on/ }).click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  await expectToast(page, t('dataSources.released'));
  await expect(page.getByText(t('dataSources.noSwitches'))).toBeVisible();

  // The register lists the site with its basis, for counsel.
  const register = page.getByRole('table', { name: t('dataSources.registerCaption') });
  await expect(register.getByRole('row', { name: new RegExp(domain) })).toContainText(
    t('dataSources.bases.public_data_assessment'),
  );
  await expectNoAxeViolations(page);
});
