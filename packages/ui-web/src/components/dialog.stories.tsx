import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen } from 'storybook/test';

import { Button } from './button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from './dialog';

function Demo({ variant }: { variant: 'modal' | 'sheet' | 'fullscreen' }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Price changed</Button>
      </DialogTrigger>
      <DialogContent
        variant={variant}
        title="The fare has changed"
        description="The airline updated this fare since you searched."
        closeLabel="Close"
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Back to results</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button>Accept new price</Button>
            </DialogClose>
          </>
        }
      >
        <p className="font-body text-body text-foreground">
          New total: ₦1,310,000 (was ₦1,250,000).
        </p>
      </DialogContent>
    </Dialog>
  );
}

const openDialog: Story['play'] = async ({ canvas, userEvent }) => {
  await userEvent.click(canvas.getByRole('button', { name: 'Price changed' }));
  await expect(await screen.findByRole('dialog', { name: 'The fare has changed' })).toBeVisible();
};

const meta = {
  title: 'Overlays/Modal and Sheet',
  component: Demo,
  args: { variant: 'modal' },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Modal: Story = { play: openDialog };
export const Sheet: Story = { args: { variant: 'sheet' }, play: openDialog };
export const Fullscreen: Story = { args: { variant: 'fullscreen' }, play: openDialog };
