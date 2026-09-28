import type { Meta, StoryObj } from '@storybook/react-vite';
import { DEFAULT_TRAVELLERS, type TravellerCounts } from '@suskii/shared';
import { useState } from 'react';
import { expect, screen } from 'storybook/test';

import { PassengerPicker, type PassengerPickerLabels } from './passenger-picker';

const passengerLabels: PassengerPickerLabels = {
  types: {
    adults: { title: 'Adults', description: '12 years and over' },
    children: { title: 'Children', description: 'Ages 2 to 11' },
    infants: { title: 'Infants', description: 'Under 2, on lap' },
  },
  increment: { adults: 'Add an adult', children: 'Add a child', infants: 'Add an infant' },
  decrement: { adults: 'Remove an adult', children: 'Remove a child', infants: 'Remove an infant' },
  done: 'Done',
  close: 'Close',
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function summarise({ adults, children, infants }: TravellerCounts): string {
  return [
    plural(adults, 'adult', 'adults'),
    children ? plural(children, 'child', 'children') : null,
    infants ? plural(infants, 'infant', 'infants') : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function Demo({ initial = DEFAULT_TRAVELLERS }: { initial?: TravellerCounts }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="max-w-popover">
      <PassengerPicker
        label="Travellers"
        summary={summarise(value)}
        value={value}
        onChange={setValue}
        labels={passengerLabels}
      />
    </div>
  );
}

const meta = {
  title: 'Forms/PassengerPicker',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Travellers/ }));
    await expect(await screen.findByRole('group', { name: 'Adults' })).toBeVisible();
  },
};

export const FullParty: Story = {
  args: { initial: { adults: 5, children: 2, infants: 2 } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Travellers/ }));
    await expect(await screen.findByRole('button', { name: 'Add a child' })).toBeDisabled();
  },
};
