import type { MessageOverlay } from '../translator';

import type { Messages } from './index';

/** American spelling on top of the base catalog. */
export const enUS: MessageOverlay<Messages> = {
  hero: {
    trustLabel: 'Why travelers book with us',
  },
  search: {
    travellers: {
      label: 'Travelers',
      close: 'Close travelers',
    },
    issues: {
      too_many_travellers: 'Up to 9 travelers per booking',
    },
  },
  sections: {
    flexiblePayment: {
      step2Body:
        'Pay for packages, tours and visa services with a deposit and scheduled installments. You see the schedule, total and any fees first.',
      step3Body:
        'Airline tickets are issued once the fare is fully paid. Missed installments follow the cancellation and refund policy shown at checkout.',
    },
    teaser: {
      packagesBody: 'Flights, hotels and extras planned together, with installment options.',
    },
    whyBook: {
      installmentsBody: 'Hold eligible fares or pay for vacations in installments.',
    },
  },
  results: {
    flights: {
      total: { one: 'Total for {count} traveler', other: 'Total for {count} travelers' },
    },
  },
  checkout: {
    travellers: 'Travelers',
    issues: {
      passenger_type_mismatch: 'This date of birth does not match the traveler type',
      passenger_count_mismatch: 'The travelers do not match the selected fare',
      traveller_not_found: 'This saved traveler is no longer available',
    },
    priceChange: {
      body: 'The supplier changed the price since you started. Review the new total before you pay.',
    },
    plan: {
      policyRefund:
        'If a payment is missed, the booking is canceled and everything you paid is refunded.',
      policyFee:
        'If a payment is missed, the booking is canceled and what you paid is refunded minus a {percent}% cancellation fee.',
    },
  },
  booking: {
    travellers: 'Travelers',
    inhouse: {
      travellers: { one: '{count} traveler', other: '{count} travelers' },
      basis: {
        per_person: { one: '{count} traveler', other: '{count} travelers' },
        per_person_per_day: { one: '{count} traveler-day', other: '{count} traveler-days' },
      },
    },
    status: { CANCELLED: 'Canceled' },
    statusHelp: { cancelled: 'This booking was canceled.' },
    plan: { states: { cancelled: 'Canceled' } },
  },
  mobile: {
    home: {
      packagesBody: 'Flights, hotels and extras planned together, with installment options.',
    },
  },
  inhouse: {
    noResults: { body: 'Try other dates, fewer travelers or a wider budget.' },
    detail: { passportRequired: 'Every traveler needs a valid passport for this trip.' },
    book: { travellers: 'Travelers' },
  },
  addons: {
    unitPrice: {
      per_person: '{price} per traveler',
      per_person_per_day: '{price} per traveler per day',
    },
    errors: { too_many_travellers: 'This add-on cannot cover this many travelers.' },
  },
  pages: {
    verticals: {
      packages: {
        title: 'Vacation packages',
        heading: 'Vacation packages',
        body: 'Flights, hotels and extras planned together, with installment options.',
      },
    },
  },
};
