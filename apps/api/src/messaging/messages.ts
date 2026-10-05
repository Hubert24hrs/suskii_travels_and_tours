import { BRAND, formatMoney, type Money } from '@suskii/shared';

import { documentDateTime } from '../documents/booking-pdf';
import { simpleEmail } from '../notifications/templates';

import type { NotificationContent } from './notification.service';

// English copy for account notifications (ADR-032), like the other email templates. Push titles
// and bodies carry no personal data; texts carry no links with tokens.

const LOCALE = 'en-NG';

export interface PriceAlertDetails {
  origin: string;
  destination: string;
  /** YYYY-MM-DD or YYYY-MM. */
  when: string;
  price: Money;
  atTarget: boolean;
  searchUrl: string;
}

const whenLabel = (when: string): string =>
  when.length === 7
    ? new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${when}-01T00:00:00Z`),
      )
    : documentDateTime(when);

export function priceAlertMessage(details: PriceAlertDetails): NotificationContent {
  const route = `${details.origin} to ${details.destination}`;
  const price = formatMoney(details.price, LOCALE);
  const lead = details.atTarget
    ? `Flights ${route} for ${whenLabel(details.when)} are now ${price}, at or below your target.`
    : `Flights ${route} for ${whenLabel(details.when)} dropped to ${price}.`;
  return {
    category: 'price_alert',
    template: 'price-alert',
    email: simpleEmail(
      `${route} is now ${price}`,
      'Price drop',
      [lead, 'Fares change often; the price is confirmed when you book.'],
      { label: 'See flights', url: details.searchUrl },
    ),
    text: `${BRAND.name}: ${lead}`,
    push: {
      title: `${route}: ${price}`,
      body: 'Your price alert found a lower fare.',
      path: '/account/alerts',
    },
  };
}

export function checkinReminderMessage(details: {
  reference: string;
  route: string;
  departureLocal: string;
  bookingUrl: string;
  bookingId: string;
}): NotificationContent {
  const lead = `Your flight ${details.route} leaves ${documentDateTime(details.departureLocal)} (local time). Online check-in is usually open now with the airline.`;
  return {
    category: 'trip_reminder',
    template: 'checkin-reminder',
    bookingId: details.bookingId,
    email: simpleEmail(
      `Check in for ${details.reference}`,
      'Time to check in',
      [
        lead,
        `Your booking reference is ${details.reference}; your e-ticket is on the booking page.`,
      ],
      { label: 'Open booking', url: details.bookingUrl },
    ),
    text: `${BRAND.name}: ${lead} Ref ${details.reference}.`,
    push: {
      title: `Check in for ${details.reference}`,
      body: 'Your flight leaves within a day.',
      path: `/trips/${details.bookingId}`,
    },
  };
}

export function primeExpiryMessage(details: {
  planName: string;
  until: Date;
  primeUrl: string;
}): NotificationContent {
  const date = documentDateTime(details.until.toISOString().slice(0, 10));
  const lead = `Your ${details.planName} membership ends on ${date}. It does not renew by itself.`;
  return {
    category: 'prime',
    template: 'prime-expiry',
    email: simpleEmail(
      `Your ${BRAND.name} Prime ends on ${date}`,
      'Keep your member prices',
      [lead, 'Buy another term before then and it starts when the current one ends.'],
      { label: 'Renew Prime', url: details.primeUrl },
    ),
    text: `${BRAND.name}: ${lead}`,
    push: { title: 'Prime ends soon', body: `Your membership ends on ${date}.`, path: '/prime' },
  };
}

export function referralRewardMessage(details: {
  amount: Money;
  walletUrl: string;
  role: 'referrer' | 'referee';
}): NotificationContent {
  const amount = formatMoney(details.amount, LOCALE);
  const lead =
    details.role === 'referrer'
      ? `Someone you invited completed their first trip: ${amount} is in your ${BRAND.name} wallet.`
      : `Welcome reward: ${amount} is in your ${BRAND.name} wallet for your first trip.`;
  return {
    category: 'payment',
    template: 'referral-reward',
    email: simpleEmail(
      `${amount} added to your wallet`,
      'Referral reward',
      [lead, 'Wallet money can pay for your next booking.'],
      { label: 'Open wallet', url: details.walletUrl },
    ),
    push: { title: 'Referral reward', body: `${amount} is in your wallet.`, path: '/account' },
  };
}
