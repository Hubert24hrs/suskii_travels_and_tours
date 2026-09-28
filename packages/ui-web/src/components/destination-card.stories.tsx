import type { Meta, StoryObj } from '@storybook/react-vite';

import { DestinationCard } from './destination-card';
import { StoryMedia } from './story-media';

const meta = {
  title: 'Commerce/DestinationCard',
  component: DestinationCard,
  decorators: [(Story) => <div className="max-w-popover">{Story()}</div>],
  args: {
    href: '#hotels/dubai',
    media: <StoryMedia />,
    city: 'Dubai',
    country: 'United Arab Emirates',
    hotelsLabel: '248 hotels',
    priceLabel: 'from ₦95,000/night',
  },
} satisfies Meta<typeof DestinationCard>;

export default meta;
export const Default: StoryObj<typeof meta> = {};
