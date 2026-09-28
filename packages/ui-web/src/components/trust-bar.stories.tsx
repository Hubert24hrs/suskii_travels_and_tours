import type { Meta, StoryObj } from '@storybook/react-vite';
import { CreditCard, Headset, ShieldCheck } from 'lucide-react';

import { TrustBar } from './trust-bar';

const meta = {
  title: 'Data display/TrustBar',
  component: TrustBar,
  args: {
    label: 'Why book with Suskii',
    // Only verified trust signals from the CMS (seed data per the brand guardrails).
    items: [
      { id: 'support', label: '24/7 support', icon: <Headset className="size-5" /> },
      {
        id: 'flexible',
        label: 'Flexible payment on every booking',
        icon: <CreditCard className="size-5" />,
      },
      { id: 'secure', label: 'Secure payments', icon: <ShieldCheck className="size-5" /> },
    ],
  },
} satisfies Meta<typeof TrustBar>;

export default meta;
export const VerifiedSignals: StoryObj<typeof meta> = {};
