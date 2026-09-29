import type { Meta, StoryObj } from '@storybook/react-vite';

import { DealCard } from './deal-card';
import { StoryMedia } from './story-media';

const meta = {
  title: 'Commerce/DealCard',
  component: DealCard,
  decorators: [(Story) => <div className="max-w-popover">{Story()}</div>],
  args: {
    href: '#search?from=LOS&to=LHR',
    media: <StoryMedia>LHR</StoryMedia>,
    originCode: 'LOS',
    destinationCode: 'LHR',
    routeLabel: 'Lagos to London',
    airlineName: 'Example Airways',
    dates: '12 Dec - 3 Jan',
    cabin: 'Economy',
    priceLabel: 'from ₦1,250,000',
    updatedLabel: 'Mock fare · updated 2 hours ago',
    ctaLabel: 'View deal',
  },
} satisfies Meta<typeof DealCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithDiscount: Story = { args: { discountLabel: 'Save 15%' } };
export const SampleFare: Story = {
  args: { statusLabel: 'Sample fare', updatedLabel: 'Updated 2 hours ago' },
};
