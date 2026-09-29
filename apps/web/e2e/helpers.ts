import type { Page } from '@playwright/test';

import { expect, t } from './fixtures';

const ordinal = (day: number): string => {
  const suffix =
    day % 100 >= 11 && day % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][day % 10] ?? 'th');
  return `${day}${suffix}`;
};

/** DayPicker's day button name, e.g. "Thursday, December 10th, 2026". */
function dayButtonName(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(date);
  return `${part({ weekday: 'long' })}, ${part({ month: 'long' })} ${ordinal(day)}, ${year}`;
}

/**
 * Picks one date (single mode) or a range in the date picker whose trigger has `id`, moving
 * forward month by month as needed, then confirms with the Done button.
 */
export async function pickDates(page: Page, id: string, ...dates: string[]): Promise<void> {
  await page.locator(`#${id}`).click();
  const picker = page.getByRole('dialog').last();
  for (const iso of dates) {
    const day = picker.getByRole('button', { name: dayButtonName(iso), exact: false });
    for (let step = 0; step < 12 && !(await day.isVisible()); step += 1) {
      await picker.getByRole('button', { name: t('search.datePicker.nextMonth') }).click();
    }
    await day.click();
  }
  await picker.getByRole('button', { name: t('search.datePicker.done') }).click();
  await expect(picker).toBeHidden();
}

/** Types into an autocomplete (downshift suffixes its input id) and picks the first match. */
export async function choose(page: Page, id: string, query: string, option: RegExp): Promise<void> {
  const input = page.locator(`#${id}-input`);
  await input.fill(query);
  await page.getByRole('option', { name: option }).first().click();
}

/** Sets the adult count in the traveller picker whose trigger has `id`. */
export async function setAdults(page: Page, id: string, adults: number): Promise<void> {
  await page.locator(`#${id}`).click();
  const picker = page.getByRole('dialog').last();
  for (let count = 1; count < adults; count += 1) {
    await picker.getByRole('button', { name: t('search.travellers.addAdult') }).click();
  }
  await picker.getByRole('button', { name: t('search.travellers.done') }).click();
  await expect(picker).toBeHidden();
}
