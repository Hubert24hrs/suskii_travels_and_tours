import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card } from './card';

const meta = {
  title: 'Layout/Card',
  component: Card,
  args: {
    className: 'flex max-w-page flex-col gap-2 p-6',
    children: (
      <>
        <h3 className="font-heading text-h4 font-bold text-heading">Flexible payment</h3>
        <p className="text-body text-foreground">Reserve today and pay before the hold deadline.</p>
      </>
    ),
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Outlined: Story = {};
export const Interactive: Story = { args: { interactive: true } };
export const Flat: Story = { args: { flat: true } };
