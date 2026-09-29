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
