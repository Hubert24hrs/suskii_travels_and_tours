import type { Meta, StoryObj } from '@storybook/react-vite';
import { Mail } from 'lucide-react';

import { Input } from './input';

const meta = {
  title: 'Forms/Input',
  component: Input,
  args: { label: 'Email address', type: 'email', placeholder: 'you@example.com' },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithIcon: Story = { args: { icon: <Mail className="size-5" /> } };
export const WithHint: Story = { args: { hint: 'We send your e-ticket here.' } };
export const WithError: Story = {
  args: { error: 'Enter a valid email address.', defaultValue: 'ada@' },
};
export const HiddenLabel: Story = { args: { hideLabel: true } };
export const Disabled: Story = { args: { disabled: true } };
