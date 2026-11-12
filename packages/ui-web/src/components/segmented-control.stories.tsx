import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { SegmentedControl } from './segmented-control';

type TripType = 'round_trip' | 'one_way' | 'multi_city';

const options = [
  { value: 'round_trip', label: 'Round trip' },
  { value: 'one_way', label: 'One way' },
  { value: 'multi_city', label: 'Multi-city' },
] as const;

function TripTypeDemo() {
  const [value, setValue] = useState<TripType>('round_trip');
  return (
    <SegmentedControl label="Trip type" options={options} value={value} onValueChange={setValue} />
  );
}

const meta = {
  title: 'Forms/SegmentedControl',
  component: TripTypeDemo,
} satisfies Meta<typeof TripTypeDemo>;

export default meta;
export const TripType: StoryObj<typeof meta> = {};
