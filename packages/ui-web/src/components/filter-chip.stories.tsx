import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { FilterChip } from './filter-chip';

const CITIES = ['All cities', 'Lagos', 'Abuja', 'Port Harcourt', 'Accra', 'Nairobi'];

function Demo() {
  const [selected, setSelected] = useState('All cities');
  return (
    <div role="group" aria-label="Departure city" className="flex gap-2 overflow-x-auto">
      {CITIES.map((city) => (
        <FilterChip key={city} selected={selected === city} onClick={() => setSelected(city)}>
          {city}
        </FilterChip>
      ))}
    </div>
  );
}

const meta = {
  title: 'Forms/FilterChip',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OriginFilter: Story = {};

export const Selected: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Abuja' }));
    await expect(canvas.getByRole('button', { name: 'Abuja' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(canvas.getByRole('button', { name: 'All cities' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  },
};
