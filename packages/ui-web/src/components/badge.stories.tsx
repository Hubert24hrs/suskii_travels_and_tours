import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from './badge';

const meta = {
  title: 'Data display/Badge',
  component: Badge,
  args: { children: 'Direct' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Promo: Story = { args: { variant: 'promo', children: 'Save 15%' } };
export const Info: Story = { args: { variant: 'info' } };
export const Success: Story = { args: { variant: 'success', children: 'Free cancellation' } };
export const Warning: Story = { args: { variant: 'warning', children: 'Few seats left' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Sold out' } };
export const Neutral: Story = { args: { variant: 'neutral', children: 'Economy' } };
