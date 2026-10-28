import { API_URL } from './stack';
import { expect, expectNoAxeViolations, expectToast, signIn, t, test } from './fixtures';

interface PublicStatus {
  components: { id: string; state: string }[];
  incidents: { title: string; resolvedAt: string | null }[];
}

const publicStatus = async (): Promise<PublicStatus> =>
  (await (await fetch(`${API_URL}/v1/status`)).json()) as PublicStatus;

/**
 * Status page incidents (ADR-087): operations open an incident, the public status shows it at
 * once, an update changes its stage and resolving it closes it for further updates.
 */
test('operations open, update and resolve a status page incident', async ({ page, stack }) => {
  await signIn(page, stack, 'statusAgent');
  await page.goto('/status');
  await expect(page.getByRole('heading', { level: 1, name: t('status.title') })).toBeVisible();

  await page.getByTestId('open-incident').click();
  const dialog = page.getByRole('dialog', { name: t('status.open') });
  await dialog.getByLabel(t('status.titleField')).fill('Card payments failing');
  await dialog.getByLabel(t('status.impact')).selectOption('major');
  await dialog.getByLabel(t('status.componentNames.payments')).check();
  await dialog
    .getByLabel(t('status.message'))
    .fill('Some card payments fail. Bank transfers and USSD still work.');
  await expectNoAxeViolations(page);
  await dialog.getByRole('button', { name: t('status.submitOpen') }).click();
  await expectToast(page, t('status.opened'));

  const card = page.getByRole('region', { name: 'Card payments failing' });
  await expect(card).toContainText(t('status.impacts.major'));
  await expect(card).toContainText('Bank transfers and USSD still work.');
  let status = await publicStatus();
  expect(status.components.find((component) => component.id === 'payments')?.state).toBe('outage');
  expect(status.incidents.map((incident) => incident.title)).toContain('Card payments failing');

  await card
    .getByRole('button', { name: `${t('status.postUpdate')}: Card payments failing` })
    .click();
  const update = page.getByRole('dialog', { name: 'Card payments failing' });
  await update.getByLabel(t('status.stage')).selectOption('resolved');
  await update.getByLabel(t('status.message')).fill('Card payments work again.');
  await update.getByRole('button', { name: t('status.postUpdate') }).click();
  await expectToast(page, t('status.resolvedToast'));
  await expect(card).toContainText(t('status.resolvedNote'));
  await expect(card.getByRole('button', { name: /^Post update/ })).toHaveCount(0);
  await expectNoAxeViolations(page);

  status = await publicStatus();
  expect(status.components.find((component) => component.id === 'payments')?.state).toBe(
    'operational',
  );
});
