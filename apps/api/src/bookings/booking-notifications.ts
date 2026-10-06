import { Inject, Injectable, Logger } from '@nestjs/common';

import { money, type Money } from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { documentDateTime, documentMoney } from '../documents/booking-pdf';
import { PrismaService } from '../infra/prisma.service';
import { EmailProvider } from '../notifications/email';
import { SmsProvider } from '../notifications/sms';
import {
  opsAlertTemplate,
  paymentDueSmsBody,
  paymentDueTemplate,
  planClosedTemplate,
  planCreatedTemplate,
  pushText,
  refundCompletedTemplate,
  refundStartedTemplate,
  type PlanClosedDetails,
  type PushKind,
} from '../notifications/templates';
import { PushTokensService } from '../push/push-tokens.service';

import { BookingAccessLinks, accessLinkUrl } from './booking-access-links';
import { itemPayload, type BookingRecord } from './booking-presenter';
import { isInhouse, type ItemPayload } from './booking-pricing';
import { inhouseSummary } from './inhouse-presenter';
import { BookingsService } from './bookings.service';
import { bookingUrl } from './booking-urls';

const DAY_MS = 86_400_000;

/** "Thu, 10 Dec 2026, 14:30 Lagos time (13:30 UTC)": deadlines are instants, shown unambiguously. */
export function instantText(date: Date): string {
  const lagos = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Africa/Lagos',
  }).format(date);
  const utc = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(date);
  return `${lagos} Lagos time (${utc} UTC)`;
}

function summaryOf(payload: ItemPayload): string {
  if (isInhouse(payload)) return inhouseSummary(payload);
  if (payload.kind === 'hotel') return `${payload.hotel.name}, ${payload.hotel.cityName}`;
  const first = payload.offer.slices[0];
  if (!first) return '';
  const place = (point: { code: string; cityName: string | null }) =>
    `${point.cityName ?? point.code} (${point.code})`;
  return `${place(first.origin)} to ${place(first.destination)}, ${documentDateTime(first.departureLocal)}`;
}

const REFUND_REASON_TEXT: Record<string, string> = {
  ticketing_failed: 'We could not confirm your booking with the airline or hotel.',
  duplicate_payment: 'We received more than one payment for it.',
  amount_mismatch: 'The amount received did not match the price.',
  late_payment: 'The payment arrived after the booking had closed.',
  installment_default: 'The payment plan was cancelled.',
  customer_cancellation: 'You cancelled the booking.',
  supplier_cancellation: 'The airline or hotel cancelled it.',
  goodwill: 'As agreed with our team.',
  risk_rejected: 'We could not complete our payment checks for this booking.',
  other: 'As agreed with our team.',
};

/**
 * Customer and operations notifications for payments, plans and refunds (ADR-018, ADR-019).
 * Failures are logged and never undo the money movement that triggered them. Operations alerts
 * carry ids and codes only.
 */
@Injectable()
export class BookingNotifications {
  private readonly logger = new Logger(BookingNotifications.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly email: EmailProvider,
    private readonly sms: SmsProvider,
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly accessLinks: BookingAccessLinks,
    private readonly pushTokens: PushTokensService,
  ) {}

  /** Push to the booking's devices once it is confirmed and its documents exist. */
  async confirmed(bookingId: string): Promise<void> {
    await this.safely('push-confirmed', async () => {
      const booking = await this.prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: { id: true, reference: true },
      });
      await this.push(booking, 'confirmed');
    });
  }

  /** The booking page, with a fresh access link for guests valid until `until`. */
  async link(
    booking: Pick<BookingRecord, 'id' | 'userId'>,
    purpose: string,
    until: Date,
  ): Promise<string> {
    const url = bookingUrl(this.config, booking.id);
    if (booking.userId) return url;
    const token = await this.accessLinks.create(
      this.prisma,
      booking.id,
      purpose,
      new Date(until.getTime() + DAY_MS),
    );
    return accessLinkUrl(url, token);
  }

  async planCreated(bookingId: string): Promise<void> {
    await this.safely('plan-created', async () => {
      const booking = await this.bookings.reload(bookingId);
      const plan = booking.paymentPlan;
      const item = booking.items[0];
      if (!plan || !item) return;
      const contact = this.bookings.contact(booking);
      const template = planCreatedTemplate({
        reference: booking.reference,
        kind: plan.kind,
        summary: summaryOf(itemPayload(item)),
        deadline: instantText(plan.deadline),
        total: documentMoney(money(plan.totalMinor, plan.currency)),
        schedule:
          plan.kind === 'installments'
            ? plan.installments.map((installment) => ({
                due:
                  installment.sequence === 0
                    ? 'Deposit, now'
                    : `By ${instantText(installment.dueAt)}`,
                amount: documentMoney(money(installment.amountMinor, installment.currency)),
              }))
            : [],
        defaultPolicy: this.policyText(plan.defaultFeeBps),
        bookingUrl: await this.link(booking, 'plan', plan.deadline),
      });
      await this.email.send({ to: contact.email, ...template });
    });
  }

  async paymentDue(bookingId: string, amount: Money, dueAt: Date): Promise<void> {
    await this.safely('payment-due', async () => {
      const booking = await this.bookings.reload(bookingId);
      const plan = booking.paymentPlan;
      if (!plan) return;
      const contact = this.bookings.contact(booking);
      const details = {
        reference: booking.reference,
        amount: documentMoney(amount),
        due: `by ${instantText(dueAt)}`,
        bookingUrl: await this.link(booking, 'reminder', plan.deadline),
        consequence:
          plan.kind === 'hold'
            ? 'If it is not paid by then, the airline releases the seats.'
            : this.policyText(plan.defaultFeeBps),
      };
      await this.email.send({ to: contact.email, ...paymentDueTemplate(details) });
      await this.sms.send({
        to: contact.phone,
        body: paymentDueSmsBody(details),
        template: 'payment-due',
      });
      await this.push(booking, 'payment-due');
    });
  }

  async planClosed(
    bookingId: string,
    details: Omit<PlanClosedDetails, 'reference'>,
  ): Promise<void> {
    await this.safely('plan-closed', async () => {
      const booking = await this.bookings.reload(bookingId);
      const contact = this.bookings.contact(booking);
      await this.email.send({
        to: contact.email,
        ...planClosedTemplate({ reference: booking.reference, ...details }),
      });
    });
  }

  async refundStarted(refundId: string): Promise<void> {
    await this.refundEmail(refundId, 'started');
  }

  async refundCompleted(refundId: string): Promise<void> {
    await this.refundEmail(refundId, 'completed');
  }

  /** Operations mailbox (when configured) plus a warning log, ids and codes only. */
  async ops(
    kind: string,
    bookingReference: string | null,
    facts: Record<string, string>,
  ): Promise<void> {
    this.logger.warn({ kind, bookingReference, ...facts }, 'operations alert');
    const to = this.config.OPS_ALERT_EMAIL;
    if (!to) return;
    await this.safely('ops-alert', () =>
      this.email.send({ to, ...opsAlertTemplate({ kind, bookingReference, facts }) }),
    );
  }

  private async refundEmail(refundId: string, stage: 'started' | 'completed'): Promise<void> {
    await this.safely(`refund-${stage}`, async () => {
      const refund = await this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
      const booking = await this.bookings.reload(refund.bookingId);
      const contact = this.bookings.contact(booking);
      const details = {
        reference: booking.reference,
        amount: documentMoney(money(refund.amountMinor, refund.currency)),
        destination: refund.destination,
        reason: REFUND_REASON_TEXT[refund.reason] ?? '',
      };
      const template =
        stage === 'started' ? refundStartedTemplate(details) : refundCompletedTemplate(details);
      await this.email.send({ to: contact.email, ...template });
      await this.push(booking, stage === 'started' ? 'refund-started' : 'refund-completed');
    });
  }

  /** Lock-screen push (ADR-022): reference and event only; the tap opens the trip. */
  private async push(booking: { id: string; reference: string }, kind: PushKind): Promise<void> {
    await this.pushTokens.sendToBooking(booking.id, {
      ...pushText(kind, booking.reference),
      path: `/trips/${booking.id}`,
    });
  }

  private policyText(defaultFeeBps: number): string {
    return defaultFeeBps === 0
      ? 'If a payment is missed, the booking is cancelled and everything you paid is refunded.'
      : `If a payment is missed, the booking is cancelled and what you paid is refunded minus a ${defaultFeeBps / 100}% cancellation fee.`;
  }

  private async safely(what: string, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.error({ what, reason: (error as Error).name }, 'notification failed');
    }
  }
}
