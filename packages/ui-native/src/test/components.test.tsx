import { DEFAULT_TRAVELLERS, type TravellerCounts } from '@suskii/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Badge } from '../components/badge';
import { Button } from '../components/button';
import { Combobox } from '../components/combobox';
import { DatePicker, type DatePickerProps } from '../components/date-picker';
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

  it('exposes test ids for the field and each suggestion', async () => {
    await render(
      <Combobox
        testID="city"
        label="City"
        items={cities}
        itemToString={(city) => city ?? ''}
        itemToKey={(city) => city.toLowerCase()}
        selectedItem={null}
        onSelectedItemChange={jest.fn()}
        onInputValueChange={jest.fn()}
        loadingLabel="Searching"
        emptyLabel="No places found"
      />,
    );
    await fireEvent.changeText(screen.getByTestId('city'), 'a');
    expect(screen.getByTestId('city-option-accra')).toBeOnTheScreen();
  });

  it('shows a selection made outside the field and keeps what the traveller types', async () => {
    function Swappable() {
      const [selected, setSelected] = useState<string | null>('Lagos');
      return (
        <>
          <Combobox
            label="From"
            items={[]}
            itemToString={(city) => city ?? ''}
            itemToKey={(city) => city}
            selectedItem={selected}
            onSelectedItemChange={setSelected}
            onInputValueChange={jest.fn()}
            loadingLabel="Searching"
            emptyLabel="No places found"
          />
          <Button onPress={() => setSelected('Accra')}>Swap</Button>
          <Button onPress={() => setSelected(null)}>Clear</Button>
        </>
      );
    }
    await render(<Swappable />);
    const field = () => screen.getByLabelText('From');
    expect(field().props.value).toBe('Lagos');

    // A swap or a prefilled form changes the selection from outside the field.
    await fireEvent.press(screen.getByRole('button', { name: 'Swap' }));
    expect(field().props.value).toBe('Accra');
    await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
    expect(field().props.value).toBe('');

    // Typing clears the selection, and the typed text stays.
    await fireEvent.press(screen.getByRole('button', { name: 'Swap' }));
    await fireEvent.changeText(field(), 'Lon');
    expect(field().props.value).toBe('Lon');
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

describe('DatePicker', () => {
  const labels = {
    done: 'Done',
    close: 'Close',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    chooseYear: 'Choose a year',
    chooseMonth: 'Choose a month',
    time: 'Time, on the 24 hour clock',
    hour: 'Hour',
    minutes: 'Minutes',
  };
  /** What an app shows for a value: a date in words, and a time after it. */
  const words = (value: string): string => {
    const day = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
    return value.length > 10 ? `${day} at ${value.slice(11)}` : day;
  };

  function Field({
    initial = '',
    onChange,
    ...props
  }: Partial<Omit<DatePickerProps, 'onChange'>> & {
    initial?: string;
    onChange?: (value: string) => void;
  }) {
    const [value, setValue] = useState(initial);
    return (
      <DatePicker
        mode="date"
        label="Date of birth"
        placeholder="Choose a date"
        formatValue={words}
        min="1906-11-12"
        max="2026-11-12"
        locale="en-GB"
        labels={labels}
        testID="dob"
        {...props}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    );
  }

  it('reaches a birth year through the years and the months, and keeps the day on Done', async () => {
    const onChange = jest.fn();
    await render(<Field start="year" onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Date of birth, Choose a date' }));

    expect(screen.getByRole('header', { name: 'Choose a year' })).toBeOnTheScreen();
    expect(screen.getByTestId('dob-year-1906')).toBeOnTheScreen();
    expect(screen.queryByTestId('dob-year-2027')).toBeNull();
    expect(screen.getByTestId('dob-done')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('dob-year-1990'));
    expect(screen.getByRole('header', { name: 'Choose a month' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'April 1990' }));
    await fireEvent.press(screen.getByRole('button', { name: /21 April 1990/ }));

    expect(screen.getByRole('button', { name: /21 April 1990/ })).toBeSelected();
    expect(screen.getByTestId('dob-value')).toHaveTextContent('21 Apr 1990');
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('dob-done'));

    expect(onChange).toHaveBeenCalledWith('1990-04-21');
    expect(screen.getByRole('button', { name: 'Date of birth, 21 Apr 1990' })).toBeOnTheScreen();
  });

  it('opens on the chosen month and keeps the old value when closed without Done', async () => {
    const onChange = jest.fn();
    await render(<Field start="year" initial="1990-04-21" onChange={onChange} />);
    await fireEvent.press(screen.getByTestId('dob'));

    expect(screen.getByTestId('dob-years')).toHaveTextContent('April 1990');
    expect(screen.getByTestId('dob-day-1990-04-21')).toBeSelected();
    await fireEvent.press(screen.getByTestId('dob-day-1990-04-22'));
    expect(screen.getByTestId('dob-value')).toHaveTextContent('22 Apr 1990');
    await fireEvent.press(screen.getByTestId('dob-sheet-close'));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Date of birth, 21 Apr 1990' })).toBeOnTheScreen();
    // The years open on the year on show, and a year leads to its months.
    await fireEvent.press(screen.getByTestId('dob'));
    await fireEvent.press(screen.getByTestId('dob-years'));
    expect(screen.getByTestId('dob-year-1990')).toBeSelected();
    await fireEvent.press(screen.getByTestId('dob-year-1991'));
    expect(screen.getByTestId('dob-years')).toHaveTextContent('1991');
  });

  it('offers only the days, months and years between the first and last day', async () => {
    // A range in the past: the calendar opens on its last month whatever today is.
    await render(<Field min="2001-03-10" max="2001-05-20" />);
    await fireEvent.press(screen.getByTestId('dob'));

    expect(screen.getByTestId('dob-years')).toHaveTextContent('May 2001');
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    expect(screen.getByTestId('dob-day-2001-05-21')).toBeDisabled();
    expect(screen.getByTestId('dob-day-2001-05-20')).toBeEnabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByTestId('dob-years')).toHaveTextContent('March 2001');
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    expect(screen.getByTestId('dob-day-2001-03-09')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('dob-years'));
    expect(screen.getByTestId('dob-year-2001')).toBeOnTheScreen();
    expect(screen.queryByTestId('dob-year-2000')).toBeNull();
    await fireEvent.press(screen.getByTestId('dob-year-2001'));
    expect(screen.getByTestId('dob-month-2001-02')).toBeDisabled();
    expect(screen.getByTestId('dob-month-2001-06')).toBeDisabled();
    expect(screen.getByTestId('dob-month-2001-04')).toBeEnabled();
  });

  it('takes a time on the 24 hour clock, and Done waits until there is one', async () => {
    const onChange = jest.fn();
    await render(
      <Field
        mode="dateTime"
        label="Pick-up"
        placeholder="Choose a date and time"
        min="2001-03-10"
        max="2001-05-20"
        testID="pickup"
        onChange={onChange}
      />,
    );
    await fireEvent.press(screen.getByTestId('pickup'));

    expect(screen.getByRole('header', { name: 'Time, on the 24 hour clock' })).toBeOnTheScreen();
    expect(screen.getByTestId('pickup-hour-00')).toBeOnTheScreen();
    expect(screen.getByTestId('pickup-hour-23')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('pickup-day-2001-05-12'));
    expect(screen.getByTestId('pickup-done')).toBeDisabled();
    expect(screen.getByTestId('pickup-value')).toHaveTextContent('Choose a date and time');

    // An hour alone is on the hour.
    await fireEvent.press(screen.getByTestId('pickup-hour-14'));
    expect(screen.getByTestId('pickup-minute-00')).toBeChecked();
    expect(screen.getByTestId('pickup-value')).toHaveTextContent('12 May 2001 at 14:00');
    await fireEvent.press(screen.getByRole('radio', { name: '35' }));
    expect(screen.getByTestId('pickup-hour-14')).toBeChecked();
    await fireEvent.press(screen.getByTestId('pickup-done'));
    expect(onChange).toHaveBeenCalledWith('2001-05-12T14:35');

    await fireEvent.press(screen.getByTestId('pickup'));
    expect(screen.getByTestId('pickup-day-2001-05-12')).toBeSelected();
    expect(screen.getByTestId('pickup-minute-35')).toBeChecked();
  });

  it('gives a chosen day its default time, and keeps a minute off the step as it is', async () => {
    const onChange = jest.fn();
    await render(
      <Field
        mode="dateTime"
        label="Pick-up"
        min="2001-03-10"
        max="2001-05-20"
        defaultTime="10:00"
        testID="pickup"
        onChange={onChange}
      />,
    );
    await fireEvent.press(screen.getByTestId('pickup'));
    await fireEvent.press(screen.getByTestId('pickup-day-2001-05-02'));
    expect(screen.getByTestId('pickup-hour-10')).toBeChecked();
    await fireEvent.press(screen.getByTestId('pickup-done'));
    expect(onChange).toHaveBeenLastCalledWith('2001-05-02T10:00');

    await render(
      <Field mode="dateTime" min="2001-03-10" max="2001-05-20" initial="2001-05-12T14:37" />,
    );
    await fireEvent.press(screen.getByTestId('dob'));
    expect(screen.getByTestId('dob-minute-37')).toBeChecked();
    expect(screen.getByTestId('dob-minute-35')).not.toBeChecked();
    await fireEvent.press(screen.getByTestId('dob-done'));
    expect(
      screen.getByRole('button', { name: 'Date of birth, 12 May 2001 at 14:37' }),
    ).toBeOnTheScreen();
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
