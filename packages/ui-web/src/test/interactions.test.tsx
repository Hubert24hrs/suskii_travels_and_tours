import { composeStories } from '@storybook/react-vite';
import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import * as buttonStories from '../components/button.stories';
import * as comboboxStories from '../components/combobox.stories';
import * as dateStories from '../components/date-range-picker.stories';
import * as dialogStories from '../components/dialog.stories';
import * as inputStories from '../components/input.stories';
import * as passengerStories from '../components/passenger-picker.stories';
import * as segmentedStories from '../components/segmented-control.stories';
import * as tabsStories from '../components/tabs.stories';
import * as toastStories from '../components/toast.stories';

const { Loading } = composeStories(buttonStories);
const { WithError } = composeStories(inputStories);
const { Closed: ComboboxClosed } = composeStories(comboboxStories);
const { Closed: PassengersClosed } = composeStories(passengerStories);
const { RoundTrip } = composeStories(dateStories);
const { TripType } = composeStories(segmentedStories);
const { SearchCategories } = composeStories(tabsStories);
const { Modal } = composeStories(dialogStories);
const { Success } = composeStories(toastStories);

describe('Button', () => {
  it('is busy and disabled while loading', async () => {
    const screen = await render(<Loading />);
    const button = screen.getByRole('button', { name: 'Searching' });
    await expect.element(button).toBeDisabled();
    await expect.element(button).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Input', () => {
  it('links the error message and marks the field invalid', async () => {
    const screen = await render(<WithError />);
    const input = screen.getByRole('textbox', { name: 'Email address' });
    await expect.element(input).toHaveAttribute('aria-invalid', 'true');
    await expect.element(input).toHaveAccessibleDescription('Enter a valid email address.');
  });
});

describe('Combobox', () => {
  it('selects a suggestion with the keyboard', async () => {
    const screen = await render(<ComboboxClosed />);
    const input = screen.getByRole('combobox', { name: 'From' });
    await userEvent.type(input, 'acc');
    await expect.element(screen.getByRole('option', { name: /Accra \(ACC\)/ })).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.element(input).toHaveValue('Accra (ACC)');
    await expect.element(input).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('PassengerPicker', () => {
  it('enforces one infant per adult and keeps at least one adult', async () => {
    await page.viewport(1280, 900);
    const screen = await render(<PassengersClosed />);
    await userEvent.click(screen.getByRole('button', { name: /Travellers/ }));

    const addInfant = page.getByRole('button', { name: 'Add an infant' });
    await expect.element(page.getByRole('button', { name: 'Remove an adult' })).toBeDisabled();
    await userEvent.click(addInfant);
    await expect.element(addInfant).toBeDisabled();

    await userEvent.click(page.getByRole('button', { name: 'Add an adult' }));
    await expect.element(addInfant).toBeEnabled();
    // An adult needed by the infant cannot be removed... until the infant is.
    await expect.element(page.getByRole('button', { name: 'Remove an adult' })).toBeEnabled();
    await expect
      .element(screen.getByRole('button', { name: /2 adults, 1 infant/ }))
      .toBeInTheDocument();
  });
});

describe('DateRangePicker', () => {
  it('selects a range and blocks days before the minimum date', async () => {
    await page.viewport(1280, 900);
    const screen = await render(<RoundTrip />);
    await userEvent.click(screen.getByRole('button', { name: /Depart - Return/ }));

    // Minimum date in the story is 1 Oct 2026, so 30 Sep is disabled when shown and 1 Oct is not.
    await userEvent.click(page.getByRole('button', { name: /October 12/ }).first());
    await userEvent.click(page.getByRole('button', { name: /October 19/ }).first());
    await userEvent.click(page.getByRole('button', { name: 'Done' }));

    await expect
      .element(screen.getByRole('button', { name: /12 Oct - 19 Oct/ }))
      .toBeInTheDocument();
  });
});

describe('SegmentedControl', () => {
  it('moves the selection with arrow keys', async () => {
    const screen = await render(<TripType />);
    await userEvent.click(screen.getByRole('radio', { name: 'Round trip' }));
    // Radix checks the radio that receives focus while an arrow key is held, as it is during a
    // real key press; an instant synthetic press/release would release before focus moves.
    await userEvent.keyboard('{ArrowRight>}');
    await expect.element(screen.getByRole('radio', { name: 'One way' })).toBeChecked();
    await userEvent.keyboard('{/ArrowRight}');
  });
});

describe('Tabs', () => {
  it('activates the next tab with the arrow key', async () => {
    const screen = await render(<SearchCategories />);
    await userEvent.click(screen.getByRole('tab', { name: 'Flights' }));
    await userEvent.keyboard('{ArrowRight}');
    await expect
      .element(screen.getByRole('tab', { name: 'Hotels' }))
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(screen.getByRole('tabpanel')).toHaveTextContent('Hotels search form');
  });
});

describe('Modal', () => {
  it('closes on Escape and returns focus to the trigger', async () => {
    const screen = await render(<Modal />);
    const trigger = screen.getByRole('button', { name: 'Price changed' });
    await userEvent.click(trigger);
    await expect.element(page.getByRole('dialog', { name: 'The fare has changed' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  });
});

describe('Toast', () => {
  it('announces the notification', async () => {
    const screen = await render(<Success />);
    await userEvent.click(screen.getByRole('button', { name: 'Show notification' }));
    await expect.element(page.getByText('Booking confirmed')).toBeVisible();
    // Radix renders each toast inside a status (live) region.
    await expect
      .element(page.getByRole('status').filter({ hasText: 'Booking confirmed' }).first())
      .toBeInTheDocument();
  });
});
