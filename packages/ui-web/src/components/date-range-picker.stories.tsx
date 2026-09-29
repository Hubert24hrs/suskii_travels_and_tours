import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, screen } from 'storybook/test';

import { DateRangePicker, type DateRange, type DateRangePickerLabels } from './date-range-picker';

const dateLabels: DateRangePickerLabels = {
  done: 'Done',
  close: 'Close',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
};

const format = (date: Date): string =>
  new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short' }).format(date);

// Fixed dates keep stories deterministic.
const MIN_DATE = new Date(2026, 9, 1);

function Demo({ mode, initial }: { mode: 'range' | 'single'; initial?: DateRange }) {
  const [value, setValue] = useState<DateRange>(initial ?? { from: undefined });
  return (
    <div className="max-w-popover">
      <DateRangePicker
        mode={mode}
        label={mode === 'range' ? 'Depart - Return' : 'Depart'}
        placeholder="Add dates"
        value={value}
        onChange={setValue}
        formatValue={({ from, to }) =>
          from ? (to ? `${format(from)} - ${format(to)}` : format(from)) : undefined
        }
        minDate={MIN_DATE}
        weekStartsOn={1}
        labels={dateLabels}
      />
    </div>
  );
}

const meta = {
  title: 'Forms/DateRangePicker',
  component: Demo,
  args: { mode: 'range' },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RoundTrip: Story = {};
export const OneWay: Story = { args: { mode: 'single' } };

export const OpenWithRange: Story = {
  args: { initial: { from: new Date(2026, 9, 12), to: new Date(2026, 9, 19) } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Depart - Return/ }));
    await expect((await screen.findAllByRole('grid')).length).toBeGreaterThan(0);
  },
};

export const WithError: Story = {
  render: () => (
    <div className="max-w-popover">
      <DateRangePicker
        mode="range"
        label="Depart - Return"
        placeholder="Add dates"
        value={{ from: undefined }}
        onChange={() => undefined}
        formatValue={() => undefined}
        labels={dateLabels}
        error="Choose a date from today"
      />
    </div>
  ),
};
