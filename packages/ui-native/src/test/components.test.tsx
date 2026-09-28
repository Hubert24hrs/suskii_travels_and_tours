import { DEFAULT_TRAVELLERS, type TravellerCounts } from '@suskii/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Badge } from '../components/badge';
import { Button } from '../components/button';
import { Combobox } from '../components/combobox';
import { DateRangePicker, type DateRange } from '../components/date-range-picker';
import { DealCard } from '../components/deal-card';
import { DestinationCard } from '../components/destination-card';
import { Input } from '../components/input';
import { Modal } from '../components/modal';
import { PassengerPicker } from '../components/passenger-picker';
import { SegmentedControl } from '../components/segmented-control';
import { Skeleton } from '../components/skeleton';
import { Tabs } from '../components/tabs';
import { ToastProvider, useToast } from '../components/toast';
import { TrustBar } from '../components/trust-bar';

import { passengerLabels, summarise } from './fixtures';

describe('Button', () => {
  it('exposes its label as the accessible name and fires onPress', async () => {
    const onPress = jest.fn();
    await render(<Button onPress={onPress}>Search flights</Button>);
    await fireEvent.press(screen.getByRole('button', { name: 'Search flights' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is busy and disabled while loading', async () => {
    const onPress = jest.fn();
    await render(
      <Button loading onPress={onPress}>
        Searching
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Searching' });
    expect(button).toBeDisabled();
    expect(button).toBeBusy();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Input', () => {
  it('uses the label as the accessible name and announces errors', async () => {
    await render(<Input label="Email address" error="Enter a valid email address." />);
    const field = screen.getByLabelText('Email address');
    expect(field.props.accessibilityHint).toBe('Enter a valid email address.');
    expect(screen.getByText('Enter a valid email address.')).toBeOnTheScreen();
  });
});

describe('SegmentedControl', () => {
  function TripType() {
    const [value, setValue] = useState<'round_trip' | 'one_way'>('round_trip');
    return (
      <SegmentedControl
        label="Trip type"
        value={value}
        onValueChange={setValue}
        options={[
          { value: 'round_trip', label: 'Round trip' },
          { value: 'one_way', label: 'One way' },
        ]}
      />
    );
  }

  it('checks the pressed option', async () => {
    await render(<TripType />);
    await fireEvent.press(screen.getByRole('radio', { name: 'One way' }));
    expect(screen.getByRole('radio', { name: 'One way' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Round trip' })).not.toBeChecked();
  });
});

describe('Tabs', () => {
  it('marks the active tab selected', async () => {
    const onValueChange = jest.fn();
    await render(
      <Tabs
        label="Search categories"
        value="flights"
        onValueChange={onValueChange}
        items={[
          { value: 'flights', label: 'Flights' },
          { value: 'hotels', label: 'Hotels' },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Flights' })).toBeSelected();
    await fireEvent.press(screen.getByRole('tab', { name: 'Hotels' }));
    expect(onValueChange).toHaveBeenCalledWith('hotels');
  });
});

describe('Combobox', () => {
  const cities = ['Lagos', 'London', 'Accra'];

  function CitySearch({ onSelect }: { onSelect: (city: string | null) => void }) {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <Combobox
        label="From"
        items={
          query ? cities.filter((city) => city.toLowerCase().startsWith(query.toLowerCase())) : []
        }
        itemToString={(city) => city ?? ''}
        itemToKey={(city) => city}
        selectedItem={selected}
        onSelectedItemChange={(city) => {
          setSelected(city);
          onSelect(city);
        }}
        onInputValueChange={setQuery}
        loadingLabel="Searching"
        emptyLabel="No places found"
      />
    );
  }

  it('shows matches and selects one', async () => {
    const onSelect = jest.fn();
    await render(<CitySearch onSelect={onSelect} />);
    await fireEvent.changeText(screen.getByLabelText('From'), 'l');
    await fireEvent.press(screen.getByRole('button', { name: 'London' }));
    expect(onSelect).toHaveBeenLastCalledWith('London');
    expect(screen.getByLabelText('From').props.value).toBe('London');
  });

  it('announces an empty result', async () => {
    await render(<CitySearch onSelect={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('From'), 'zz');
    expect(screen.getByText('No places found')).toBeOnTheScreen();
  });
});

describe('PassengerPicker', () => {
  function Demo() {
    const [value, setValue] = useState<TravellerCounts>(DEFAULT_TRAVELLERS);
    return (
      <PassengerPicker
        label="Travellers"
        summary={summarise(value)}
        value={value}
        onChange={setValue}
        labels={passengerLabels}
      />
    );
  }

  it('enforces one infant per adult and never removes the last adult', async () => {
    await render(<Demo />);
    await fireEvent.press(screen.getByRole('button', { name: /Travellers/ }));

    expect(screen.getByRole('button', { name: 'Remove an adult' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Add an infant' }));
    expect(screen.getByRole('button', { name: 'Add an infant' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Add an adult' }));
    expect(screen.getByRole('button', { name: 'Add an infant' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Travellers, 2 adults, 0 children, 1 infants' }),
    ).toBeOnTheScreen();
  });
});

describe('DateRangePicker', () => {
  function Demo() {
    const [value, setValue] = useState<DateRange>({ from: undefined });
    return (
      <DateRangePicker
        mode="range"
        label="Dates"
        placeholder="Add dates"
        value={value}
        onChange={setValue}
        formatValue={({ from, to }) =>
          from ? `${from.getDate()}-${to?.getDate() ?? ''}` : undefined
        }
        minDate={new Date(2026, 9, 10)}
        monthCount={2}
        locale="en-GB"
        labels={{ done: 'Done', close: 'Close' }}
      />
    );
  }

  it('selects a range and disables days before the minimum', async () => {
    await render(<Demo />);
    await fireEvent.press(screen.getByRole('button', { name: 'Dates, Add dates' }));

    expect(screen.getByRole('button', { name: /\b9 October 2026/ })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: /\b12 October 2026/ }));
    await fireEvent.press(screen.getByRole('button', { name: /\b19 October 2026/ }));

    expect(screen.getByRole('button', { name: /\b15 October 2026/ })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Dates, 12-19' })).toBeOnTheScreen();
  });
});

describe('Modal', () => {
  it('renders an announced title and closes from the close button', async () => {
    const onOpenChange = jest.fn();
    await render(
      <Modal open onOpenChange={onOpenChange} title="The fare has changed" closeLabel="Close">
        <Text>New total</Text>
      </Modal>,
    );
    expect(screen.getByRole('header', { name: 'The fare has changed' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('Toast', () => {
  function Trigger() {
    const { toast } = useToast();
    return (
      <Button onPress={() => toast({ title: 'Booking confirmed', variant: 'success' })}>
        Notify
      </Button>
    );
  }

  it('shows the notification and dismisses it', async () => {
    await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 800 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <ToastProvider closeLabel="Dismiss">
          <Trigger />
        </ToastProvider>
      </SafeAreaProvider>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Notify' }));
    expect(screen.getByText('Booking confirmed')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Booking confirmed')).not.toBeOnTheScreen();
  });
});

describe('display components', () => {
  it('renders cards, badge, trust bar and skeleton without crashing', async () => {
    const onPress = jest.fn();
    await render(
      <>
        <DealCard
          media={null}
          originCode="LOS"
          destinationCode="LHR"
          routeLabel="Lagos to London"
          airlineName="Example Airways"
          dates="12 Dec - 3 Jan"
          cabin="Economy"
          priceLabel="from ₦1,250,000"
          discountLabel="Save 15%"
          updatedLabel="Updated 2 hours ago"
          ctaLabel="View deal"
          onPress={onPress}
        />
        <DestinationCard
          media={null}
          city="Dubai"
          country="UAE"
          hotelsLabel="248 hotels"
          priceLabel="from ₦95,000/night"
          onPress={onPress}
        />
        <Badge variant="success">Free cancellation</Badge>
        <TrustBar
          label="Why book with us"
          items={[{ id: 'support', label: '24/7 support', icon: null }]}
        />
        <Skeleton className="h-4 w-full" />
      </>,
    );
    expect(screen.getByRole('header', { name: 'Lagos to London' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'View deal' }));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Dubai, UAE. 248 hotels, from ₦95,000/night' }),
    );
    expect(onPress).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Free cancellation')).toBeOnTheScreen();
    expect(screen.getByText('24/7 support')).toBeOnTheScreen();
  });
});
