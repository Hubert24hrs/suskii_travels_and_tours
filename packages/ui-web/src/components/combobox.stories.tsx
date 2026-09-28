import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlaneTakeoff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { expect, within } from 'storybook/test';

import { Combobox } from './combobox';

interface Airport {
  iata: string;
  city: string;
  name: string;
  country: string;
}

// Real IATA codes for demo purposes; production data comes from the catalog API (phase 3).
const airports: Airport[] = [
  { iata: 'LOS', city: 'Lagos', name: 'Murtala Muhammed International', country: 'Nigeria' },
  { iata: 'ABV', city: 'Abuja', name: 'Nnamdi Azikiwe International', country: 'Nigeria' },
  { iata: 'PHC', city: 'Port Harcourt', name: 'Port Harcourt International', country: 'Nigeria' },
  { iata: 'ACC', city: 'Accra', name: 'Kotoka International', country: 'Ghana' },
  { iata: 'NBO', city: 'Nairobi', name: 'Jomo Kenyatta International', country: 'Kenya' },
  { iata: 'LHR', city: 'London', name: 'Heathrow', country: 'United Kingdom' },
  { iata: 'DXB', city: 'Dubai', name: 'Dubai International', country: 'United Arab Emirates' },
];

function AirportSearch({ loading = false }: { loading?: boolean }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Airport | null>(null);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (loading || !q) return [];
    return airports.filter((a) =>
      [a.iata, a.city, a.name, a.country].some((v) => v.toLowerCase().includes(q)),
    );
  }, [query, loading]);

  return (
    <div className="max-w-popover">
      <Combobox
        id="origin"
        label="From"
        placeholder="City or airport"
        icon={<PlaneTakeoff className="size-5" />}
        items={items}
        itemToString={(a) => (a ? `${a.city} (${a.iata})` : '')}
        itemToKey={(a) => a.iata}
        renderItem={(a) => (
          <span className="flex flex-col">
            <span className="font-bold">
              {a.city} ({a.iata})
            </span>
            <span className="text-body-sm text-muted">
              {a.name}, {a.country}
            </span>
          </span>
        )}
        selectedItem={selected}
        onSelectedItemChange={setSelected}
        onInputValueChange={setQuery}
        loading={loading}
        loadingLabel="Searching airports"
        emptyLabel="No airports found"
      />
    </div>
  );
}

const meta = {
  title: 'Forms/Combobox',
  component: AirportSearch,
} satisfies Meta<typeof AirportSearch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const WithSuggestions: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox', { name: 'From' }), 'lag');
    await expect(await canvas.findByRole('option', { name: /Lagos \(LOS\)/ })).toBeVisible();
  },
};

export const NoResults: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox', { name: 'From' }), 'zzz');
    await expect(within(canvas.getByRole('status')).getByText('No airports found')).toBeVisible();
  },
};

export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox', { name: 'From' }), 'lon');
    await expect(canvas.getByRole('status')).toHaveTextContent('Searching airports');
  },
};
