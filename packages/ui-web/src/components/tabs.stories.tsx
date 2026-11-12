import type { Meta, StoryObj } from '@storybook/react-vite';
import { BedDouble, FileCheck, Luggage, Map, Package, Plane } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

const verticals = [
  { value: 'flights', label: 'Flights', icon: <Plane className="size-5" /> },
  { value: 'hotels', label: 'Hotels', icon: <BedDouble className="size-5" /> },
  { value: 'packages', label: 'Packages', icon: <Package className="size-5" /> },
  { value: 'tours', label: 'Tours', icon: <Map className="size-5" /> },
  { value: 'visa', label: 'Visa', icon: <FileCheck className="size-5" /> },
  { value: 'addons', label: 'Travel Add-ons', icon: <Luggage className="size-5" /> },
];

const meta = {
  title: 'Navigation/Tabs',
  component: Tabs,
  render: () => (
    <Tabs defaultValue="flights">
      <TabsList aria-label="Search categories">
        {verticals.map((vertical) => (
          <TabsTrigger key={vertical.value} value={vertical.value} icon={vertical.icon}>
            {vertical.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {verticals.map((vertical) => (
        <TabsContent key={vertical.value} value={vertical.value}>
          <p className="text-body text-foreground">{vertical.label} search form</p>
        </TabsContent>
      ))}
    </Tabs>
  ),
} satisfies Meta<typeof Tabs>;

export default meta;
export const SearchCategories: StoryObj<typeof meta> = {};
