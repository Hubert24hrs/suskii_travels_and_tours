import { BRAND } from '@suskii/shared';

import type { EmailMessage } from './email';

// Plain, English-only copy until the i18n package lands (phase 4). Links carry tokens in the URL
// fragment, so they never reach server logs or Referer headers.

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function layout(heading: string, paragraphs: string[], action?: { label: string; url: string }) {
  const body = paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join('');
  const button = action
    ? `<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></p>`
    : '';
  return `<!doctype html><html><body><h1>${escapeHtml(heading)}</h1>${body}${button}<p>${escapeHtml(BRAND.name)}</p></body></html>`;
}

type Template = Omit<EmailMessage, 'to'>;

/** Subject, plain text and HTML for a short message with one optional link. */
export function simpleEmail(
  subject: string,
  heading: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): { subject: string; text: string; html: string } {
  return {
    subject,
    text: [...paragraphs, ...(action ? [action.url] : [])].join('\n\n'),
    html: layout(heading, paragraphs, action),
  };
}

export function verifyEmailTemplate(url: string): Template {
  const intro = `Confirm your email address to finish setting up your ${BRAND.name} account.`;
  const expiry = 'This link expires in 24 hours. If you did not sign up, ignore this email.';
  return {
    template: 'verify-email',
    subject: `Confirm your email for ${BRAND.name}`,
    text: `${intro}\n\n${url}\n\n${expiry}`,
    html: layout('Confirm your email', [intro, expiry], { label: 'Confirm email', url }),
  };
}

export function accountExistsTemplate(signInUrl: string): Template {
  const intro = `Someone tried to create a ${BRAND.name} account with this email address, which already has an account.`;
  const next =
    'If it was you, sign in or reset your password. Otherwise you can ignore this email.';
  return {
    template: 'account-exists',
    subject: `You already have a ${BRAND.name} account`,
    text: `${intro}\n\n${next}\n\n${signInUrl}`,
    html: layout('You already have an account', [intro, next], {
      label: 'Sign in',
      url: signInUrl,
    }),
  };
}

export function passwordResetTemplate(url: string): Template {
  const intro = 'We received a request to reset your password.';
  const expiry =
    'This link expires in 30 minutes and signs you out everywhere. If you did not ask for it, ignore this email.';
  return {
    template: 'password-reset',
    subject: `Reset your ${BRAND.name} password`,
    text: `${intro}\n\n${url}\n\n${expiry}`,
    html: layout('Reset your password', [intro, expiry], { label: 'Reset password', url }),
  };
}

export function newsletterConfirmTemplate(confirmUrl: string, unsubscribeUrl: string): Template {
  const intro = `Confirm that you want deal alerts from ${BRAND.name}: fresh fares and offers, a few times a month.`;
  const expiry =
    'This link expires in 48 hours. If you did not sign up, ignore this email and nothing will be sent.';
  const leave = `Changed your mind later? Unsubscribe any time: ${unsubscribeUrl}`;
  return {
    template: 'newsletter-confirm',
    subject: `Confirm your deal alerts from ${BRAND.name}`,
    text: `${intro}\n\n${confirmUrl}\n\n${expiry}\n\n${leave}`,
    html: layout('Confirm your deal alerts', [intro, expiry, leave], {
      label: 'Confirm subscription',
      url: confirmUrl,
    }),
  };
}

export interface BookingConfirmedDetails {
  reference: string;
  vertical: 'flights' | 'hotels' | 'packages' | 'tours' | 'visa' | 'travel_addons' | 'prime';
  /** "Lagos (LOS) to Dubai (DXB), Thu, 10 Dec 2026" or "The Palm Suites, Dubai, 10 to 13 Dec 2026". */
  summary: string;
  /** Airline or hotel reference label; null for Suskii's own products. */
  supplierLabel: string | null;
  supplierReference: string;
  total: string;
  /** Account bookings link to the booking page; guest links would need the access token. */
  bookingUrl: string | null;
}

const CONFIRMED_COPY: Record<
  BookingConfirmedDetails['vertical'],
  { what: string; document: string }
> = {
  flights: { what: 'flight', document: 'e-ticket receipt' },
  hotels: { what: 'stay', document: 'hotel voucher' },
  packages: { what: 'holiday package', document: 'package voucher' },
  tours: { what: 'tour', document: 'tour voucher' },
  visa: { what: 'visa assistance', document: 'confirmation' },
  travel_addons: { what: 'add-on', document: 'voucher' },
  prime: { what: 'Suskii Prime membership', document: 'receipt' },
};

/** Every visa page, PDF and email says who decides (ADR-026). */
export const VISA_DISCLAIMER =
  'Suskii helps you prepare and submit your application. The decision on any visa rests with the issuing government; government fees are paid to the authority and are not refundable by us.';

export function bookingConfirmedTemplate(details: BookingConfirmedDetails): Template {
  const { what, document } = CONFIRMED_COPY[details.vertical];
  const intro = `Your ${what} is booked. Booking reference: ${details.reference}.`;
  const lines = [
    details.summary,
    ...(details.supplierLabel ? [`${details.supplierLabel}: ${details.supplierReference}`] : []),
    `Total paid: ${details.total}`,
    ...(details.vertical === 'visa'
      ? [
          'Next step: upload the documents on your checklist from the booking page.',
          VISA_DISCLAIMER,
        ]
      : []),
    details.vertical === 'prime'
      ? 'Member prices apply as soon as you sign in again. Keep this email as your receipt.'
      : `Your ${document} is attached. Keep this email: you need the booking reference to manage the booking.`,
  ];
  return {
    template: 'booking-confirmed',
    subject: `Booking confirmed: ${details.reference}`,
    text: [intro, lines.join('\n'), details.bookingUrl].filter(Boolean).join('\n\n'),
    html: layout(
      'Booking confirmed',
      [intro, ...lines],
      details.bookingUrl ? { label: 'View booking', url: details.bookingUrl } : undefined,
    ),
  };
}

export interface PlanScheduleLine {
  due: string;
  amount: string;
}

export interface PlanCreatedDetails {
  reference: string;
  kind: 'hold' | 'installments';
  summary: string;
  deadline: string;
  total: string;
  schedule: PlanScheduleLine[];
  /** What happens on a missed payment, from the configured policy. */
  defaultPolicy: string;
  /** Booking page, with the guest access link when needed. */
  bookingUrl: string;
}

export function planCreatedTemplate(details: PlanCreatedDetails): Template {
  const intro =
    details.kind === 'hold'
      ? `Your seats are reserved. Booking reference: ${details.reference}. Pay ${details.total} by ${details.deadline} to get your tickets.`
      : `Your payment plan is set up. Booking reference: ${details.reference}. Total ${details.total}, paid by ${details.deadline}.`;
  const lines = [
    details.summary,
    ...details.schedule.map((line) => `${line.due}: ${line.amount}`),
    'Tickets are issued only after the last payment.',
    details.defaultPolicy,
  ];
  return {
    template: details.kind === 'hold' ? 'booking-held' : 'payment-plan-created',
    subject:
      details.kind === 'hold'
        ? `Reserved: ${details.reference}, pay by ${details.deadline}`
        : `Payment plan for ${details.reference}`,
    text: [intro, lines.join('\n'), details.bookingUrl].join('\n\n'),
    html: layout(
      details.kind === 'hold' ? 'Seats reserved' : 'Payment plan set up',
      [intro, ...lines],
      {
        label: 'View booking and pay',
        url: details.bookingUrl,
      },
    ),
  };
}

export interface PaymentDueDetails {
  reference: string;
  amount: string;
  due: string;
  bookingUrl: string;
  /** What happens if it is not paid. */
  consequence: string;
}

export function paymentDueTemplate(details: PaymentDueDetails): Template {
  const intro = `A payment of ${details.amount} for booking ${details.reference} is due ${details.due}.`;
  return {
    template: 'payment-due',
    subject: `Payment due ${details.due}: ${details.reference}`,
    text: [intro, details.consequence, details.bookingUrl].join('\n\n'),
    html: layout('Payment due', [intro, details.consequence], {
      label: 'Pay now',
      url: details.bookingUrl,
    }),
  };
}

export function paymentDueSmsBody(details: PaymentDueDetails): string {
  return `${BRAND.name}: ${details.amount} for booking ${details.reference} is due ${details.due}. Pay from the link in your email.`;
}

export interface RefundDetails {
  reference: string;
  amount: string;
  destination: 'original' | 'wallet';
  /** Why the money goes back, in plain words. */
  reason: string;
}

export function refundStartedTemplate(details: RefundDetails): Template {
  const where =
    details.destination === 'wallet'
      ? 'It goes to your Suskii wallet.'
      : 'It goes back to the card or account you paid with; banks usually take 5 to 10 working days.';
  const intro = `We are refunding ${details.amount} for booking ${details.reference}. ${details.reason}`;
  return {
    template: 'refund-started',
    subject: `Refund on its way: ${details.reference}`,
    text: `${intro}\n\n${where}`,
    html: layout('Refund on its way', [intro, where]),
  };
}

export function refundCompletedTemplate(details: RefundDetails): Template {
  const intro = `Your refund of ${details.amount} for booking ${details.reference} is complete.`;
  const where =
    details.destination === 'wallet'
      ? 'It is in your Suskii wallet now.'
      : 'Your bank may take a few days to show it.';
  return {
    template: 'refund-completed',
    subject: `Refund completed: ${details.reference}`,
    text: `${intro}\n\n${where}`,
    html: layout('Refund completed', [intro, where]),
  };
}

export interface PlanClosedDetails {
  reference: string;
  reason: 'missed_payment' | 'expired' | 'cancelled';
  refund: string | null;
  fee: string | null;
}

export function planClosedTemplate(details: PlanClosedDetails): Template {
  const why =
    details.reason === 'missed_payment'
      ? `A payment for booking ${details.reference} was not made in time, so the reservation has been cancelled.`
      : details.reason === 'expired'
        ? `The reservation for booking ${details.reference} was not paid by its deadline and has been released.`
        : `Booking ${details.reference} has been cancelled as you asked.`;
  const money = details.refund
    ? `${details.refund} will be refunded${details.fee ? ` (a cancellation fee of ${details.fee} was kept, as set out in your plan)` : ''}.`
    : 'No payment was taken, so there is nothing to refund.';
  return {
    template: 'payment-plan-closed',
    subject: `Booking ${details.reference} cancelled`,
    text: `${why}\n\n${money}`,
    html: layout('Booking cancelled', [why, money]),
  };
}

export interface OpsAlertDetails {
  /** Short code, e.g. `refund.failed`, `ticketing.needs_review`. */
  kind: string;
  bookingReference: string | null;
  /** Ids and codes only: never personal data, card data or free text. */
  facts: Record<string, string>;
}

export function opsAlertTemplate(details: OpsAlertDetails): Template {
  const lines = Object.entries(details.facts).map(([key, value]) => `${key}: ${value}`);
  const heading = `[ops] ${details.kind}${details.bookingReference ? ` ${details.bookingReference}` : ''}`;
  return {
    template: 'ops-alert',
    subject: heading,
    text: [heading, ...lines].join('\n'),
    html: layout(heading, lines),
  };
}

export function otpSmsBody(code: string): string {
  return `${code} is your ${BRAND.name} verification code. It expires in 5 minutes. Never share it.`;
}

export type PushKind = 'confirmed' | 'payment-due' | 'refund-started' | 'refund-completed';

/**
 * Lock-screen text for pushes (ADR-022): the booking reference and the event only, never names,
 * routes, amounts or document numbers.
 */
export function pushText(kind: PushKind, reference: string): { title: string; body: string } {
  switch (kind) {
    case 'confirmed':
      return {
        title: `Booking ${reference} is confirmed`,
        body: 'Your documents are ready in the app.',
      };
    case 'payment-due':
      return {
        title: `Payment due for booking ${reference}`,
        body: 'Open the app to pay before the deadline.',
      };
    case 'refund-started':
      return {
        title: `Refund started for booking ${reference}`,
        body: 'We will let you know when it is complete.',
      };
    case 'refund-completed':
      return {
        title: `Refund completed for booking ${reference}`,
        body: 'Open the app for the details.',
      };
  }
}

const VISA_STATUS_TEXT: Record<string, string> = {
  submitted: 'We received your documents and will review them shortly.',
  in_review: 'Our visa team is reviewing your documents.',
  action_required: 'We need something more from you before we can continue.',
  lodged: 'Your application has been lodged with the authority.',
  approved: 'The authority has approved your visa.',
  refused: 'The authority has refused this application.',
  withdrawn: 'This application has been withdrawn.',
  awaiting_documents: 'Please upload the documents on your checklist.',
};

export interface VisaUpdateDetails {
  reference: string;
  status: string;
  /** A message from the visa team, if any. */
  message: string | null;
  bookingUrl: string | null;
}

/** A visa application changed status or the visa team wrote to the traveller (ADR-026). */
export function visaUpdateTemplate(details: VisaUpdateDetails): Template {
  const lines = [
    VISA_STATUS_TEXT[details.status] ?? 'Your visa application was updated.',
    ...(details.message ? [`Message from our visa team: ${details.message}`] : []),
    'Open your booking to see the details and upload documents.',
    VISA_DISCLAIMER,
  ];
  return {
    template: 'visa-update',
    subject: `Visa application update: ${details.reference}`,
    text: [lines.join('\n\n'), details.bookingUrl].filter(Boolean).join('\n\n'),
    html: layout(
      'Visa application update',
      lines,
      details.bookingUrl ? { label: 'View booking', url: details.bookingUrl } : undefined,
    ),
  };
}
