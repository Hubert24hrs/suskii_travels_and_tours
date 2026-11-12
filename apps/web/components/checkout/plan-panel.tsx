'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card, Dialog, DialogContent } from '@suskii/ui-web';
import { useState } from 'react';

import type { Schemas } from '../../lib/browser-api';

import { useBookingT } from './checkout-messages';

type Booking = Schemas['Booking'];
type Plan = NonNullable<Booking['paymentPlan']>;

const STATE_VARIANT = { paid: 'success', pending: 'info', cancelled: 'neutral' } as const;

/**
 * A reservation or installment plan on the booking page (ADR-018): what is paid, what is due and
 * by when, the next payment, and cancelling under the plan's policy.
 */
export function PlanPanel({
  booking,
  plan,
  busy,
  onPay,
  onCancel,
}: {
  booking: Booking;
  plan: Plan;
  busy: boolean;
  onPay: (options: { payInFull: boolean }) => void;
  onCancel: () => Promise<void>;
}) {
  const { t } = useBookingT();
  const format = useFormatters();
  const [confirming, setConfirming] = useState(false);
  const active = plan.status === 'active';
  const pending = plan.installments.filter((installment) => installment.status === 'pending');
  const remaining = {
    amountMinor: Math.max(0, plan.total.amountMinor - booking.paid.amountMinor),
    currency: plan.total.currency,
  };
  const depositDue =
    plan.kind === 'installments' && plan.installments[0]?.status === 'pending' && active;
  const next = plan.kind === 'installments' && !depositDue ? pending[0] : undefined;
  const refund = booking.paid;
  const fee = {
    amountMinor: Math.floor((refund.amountMinor * plan.defaultFeeBps) / 10_000),
    currency: refund.currency,
  };
  const afterFee = { amountMinor: refund.amountMinor - fee.amountMinor, currency: refund.currency };

  return (
    <Card asChild className="flex flex-col gap-3 p-4">
      <section aria-labelledby="booking-plan" data-testid="payment-plan">
        <h2 id="booking-plan" className="font-heading text-h3 font-bold text-heading">
          {plan.kind === 'hold'
            ? t('booking.plan.holdHeading')
            : t('booking.plan.installmentsHeading')}
        </h2>
        {active ? (
          <p className="font-body text-body text-foreground">
            {depositDue
              ? t('booking.plan.depositNow')
              : next
                ? t('booking.plan.nextDue', {
                    amount: format.money(booking.amountDue ?? next.amount),
                    date: format.dateTime(next.dueAt),
                  })
                : t(
                    booking.vertical === 'packages'
                      ? 'booking.plan.deadlinePackage'
                      : 'booking.plan.deadline',
                    { deadline: format.dateTime(plan.deadline) },
                  )}
          </p>
        ) : null}
        <p className="font-body text-body-sm text-foreground" data-testid="plan-paid">
          {t('booking.plan.paidOf', {
            paid: format.money(booking.paid),
            total: format.money(plan.total),
          })}
        </p>
        {plan.kind === 'installments' ? (
          <ol className="flex flex-col gap-2">
            {plan.installments.map((installment) => (
              <li
                key={installment.id}
                className="flex flex-wrap items-center justify-between gap-3 font-body text-body-sm text-foreground"
              >
                <span className="flex flex-col">
                  <span className="font-bold">
                    {installment.sequence === 0
                      ? t('booking.plan.deposit')
                      : t('booking.plan.payment', { number: installment.sequence })}
                  </span>
                  <span>
                    {t('booking.plan.dueBy', { date: format.dateTime(installment.dueAt) })}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-bold">{format.money(installment.amount)}</span>
                  <Badge variant={STATE_VARIANT[installment.status]}>
                    {t(`booking.plan.states.${installment.status}`)}
                  </Badge>
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        {plan.fee.amountMinor > 0 ? (
          <p className="font-body text-body-sm text-foreground">
            {t('checkout.plan.fee', { amount: format.money(plan.fee) })}
          </p>
        ) : null}
        <p className="font-body text-body-sm text-foreground">
          {t(
            booking.vertical === 'packages'
              ? 'booking.plan.voucherAfter'
              : 'booking.plan.ticketsAfter',
          )}
        </p>
        {active ? (
          <p className="font-body text-body-sm text-foreground">
            {plan.defaultFeeBps === 0
              ? t('checkout.plan.policyRefund')
              : t('checkout.plan.policyFee', { percent: plan.defaultFeeBps / 100 })}
          </p>
        ) : null}
        {active ? (
          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
            {booking.amountDue ? (
              <Button loading={busy} onClick={() => onPay({ payInFull: false })}>
                {t('booking.plan.payNext', { amount: format.money(booking.amountDue) })}
              </Button>
            ) : null}
            {pending.length > 1 ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => onPay({ payInFull: true })}
              >
                {t('booking.plan.payRest', { amount: format.money(remaining) })}
              </Button>
            ) : null}
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
              {t('booking.plan.cancel')}
            </Button>
          </div>
        ) : null}

        <Dialog open={confirming} onOpenChange={setConfirming}>
          {confirming ? (
            <DialogContent
              title={t('booking.plan.cancelTitle')}
              description={
                refund.amountMinor === 0
                  ? t('booking.plan.cancelNothingPaid')
                  : fee.amountMinor > 0
                    ? t('booking.plan.cancelRefundFee', {
                        amount: format.money(afterFee),
                        fee: format.money(fee),
                      })
                    : t('booking.plan.cancelRefund', { amount: format.money(refund) })
              }
              closeLabel={t('common.close')}
            >
              <div className="flex flex-col gap-2 md:flex-row md:justify-end">
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  {t('booking.plan.cancelKeep')}
                </Button>
                <Button
                  loading={busy}
                  onClick={() => {
                    void onCancel().finally(() => setConfirming(false));
                  }}
                >
                  {t('booking.plan.cancelConfirm')}
                </Button>
              </div>
            </DialogContent>
          ) : null}
        </Dialog>
      </section>
    </Card>
  );
}

const REFUND_VARIANT = { in_progress: 'warning', completed: 'success', failed: 'danger' } as const;

/** Money going back for this booking, in the traveller's words (ADR-019). */
export function RefundList({ refunds }: { refunds: Booking['refunds'] }) {
  const { t } = useBookingT();
  const format = useFormatters();
  if (refunds.length === 0) return null;
  return (
    <Card asChild className="flex flex-col gap-3 p-4">
      <section aria-labelledby="booking-refunds" data-testid="refunds">
        <h2 id="booking-refunds" className="font-heading text-h4 font-bold text-heading">
          {t('booking.refunds.heading')}
        </h2>
        <ul className="flex flex-col gap-2">
          {refunds.map((refund) => (
            <li
              key={refund.id}
              className="flex flex-col items-start gap-1 font-body text-body-sm text-foreground"
            >
              <span>
                {t('booking.refunds.line', {
                  amount: format.money(refund.amount),
                  destination: t(`booking.refunds.destinations.${refund.destination}`),
                })}
              </span>
              <Badge variant={REFUND_VARIANT[refund.status]}>
                {t(`booking.refunds.states.${refund.status}`)}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
    </Card>
  );
}
