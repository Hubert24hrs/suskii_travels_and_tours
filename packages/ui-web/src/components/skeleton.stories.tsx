import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card } from './card';
import { Skeleton } from './skeleton';

const meta = {
  title: 'Feedback/Skeleton',
  component: Skeleton,
  render: () => (
    <Card role="status" aria-busy="true" className="flex max-w-popover flex-col overflow-hidden">
      <span className="sr-only">Loading deals</span>
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </Card>
  ),
} satisfies Meta<typeof Skeleton>;

export default meta;
export const DealCardPlaceholder: StoryObj<typeof meta> = {};
