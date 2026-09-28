import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plane } from 'lucide-react';

import { Button } from './button';

const meta = {
  title: 'Actions/Button',
  component: Button,
  args: { children: 'Search flights' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'secondary', children: 'Join Suskii Prime' } };
export const Ghost: Story = { args: { variant: 'ghost', children: 'Learn more' } };
export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Plane aria-hidden="true" className="size-5" /> Search flights
      </>
    ),
  },
};
export const Loading: Story = { args: { loading: true, children: 'Searching' } };
export const Disabled: Story = { args: { disabled: true } };
export const FullWidthOnMobile: Story = { args: { fullWidth: 'mobile' } };
export const AsLink: Story = {
  args: { asChild: true, variant: 'secondary', children: <a href="#deal">View deal</a> },
};
