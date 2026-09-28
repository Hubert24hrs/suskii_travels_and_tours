import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen } from 'storybook/test';

import { Button } from './button';
import { ToastProvider, useToast, type ToastVariant } from './toast';

function Trigger({ variant }: { variant: ToastVariant }) {
  const { toast } = useToast();
  return (
    <Button
      onClick={() =>
        toast({
          variant,
          title: variant === 'error' ? 'Payment failed' : 'Booking confirmed',
          description:
            variant === 'error' ? 'Your card was not charged.' : 'Your e-ticket is on its way.',
          duration: 60_000,
        })
      }
    >
      Show notification
    </Button>
  );
}

function Demo({ variant }: { variant: ToastVariant }) {
  return (
    <ToastProvider label="Notifications" closeLabel="Dismiss">
      <Trigger variant={variant} />
    </ToastProvider>
  );
}

const meta = {
  title: 'Feedback/Toast',
  component: Demo,
  args: { variant: 'success' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Show notification' }));
    await expect(await screen.findByRole('button', { name: 'Dismiss' })).toBeVisible();
  },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {};
export const Error: Story = { args: { variant: 'error' } };
export const Info: Story = { args: { variant: 'info' } };
