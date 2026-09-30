import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card, Modal } from '@suskii/ui-native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useT } from '../../providers/app-provider';

type Booking = Schemas['Booking'];
type Plan = NonNullable<Booking['paymentPlan']>;

const STATE_VARIANT = { paid: 'success', pending: 'info', cancelled: 'neutral' } as const;
const REFUND_VARIANT = { in_progress: 'warning', completed: 'success', failed: 'danger' } as const;

/** A reservation or installment plan (ADR-018): paid so far, schedule, next payment, cancel. */
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
  const { t } = useT();
  const format = useFormatters();
  const [confirming, setConfirming] = useState(false);
  const active = plan.status === 'active';
  const pending = plan.installments.filter((installment) => installment.status === 'pending');
  const depositDue =
    plan.kind === 'installments' && plan.installments[0]?.status === 'pending' && active;
  const next = plan.kind === 'installments' && !depositDue ? pending[0] : undefined;
  const remaining = {
    amountMinor: Math.max(0, plan.total.amountMinor - booking.paid.amountMinor),
    currency: plan.total.currency,
  };
  const fee = {
    amountMinor: Math.floor((booking.paid.amountMinor * plan.defaultFeeBps) / 10_000),
    currency: booking.paid.currency,
  };
  const afterFee = {
    amountMinor: booking.paid.amountMinor - fee.amountMinor,
    currency: fee.currency,
  };

  return (
    <Card className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {plan.kind === 'hold'
          ? t('booking.plan.holdHeading')
          : t('booking.plan.installmentsHeading')}
      </Text>
      {active ? (
        <Text className="font-body text-body-sm text-foreground">
          {depositDue
            ? t('booking.plan.depositNow')
            : next
              ? t('booking.plan.nextDue', {
                  amount: format.money(booking.amountDue ?? next.amount),
                  date: format.dateTime(next.dueAt),
                })
              : t('booking.plan.deadline', { deadline: format.dateTime(plan.deadline) })}
        </Text>
      ) : null}
      <Text testID="plan-paid" className="font-body text-body-sm text-foreground">
        {t('booking.plan.paidOf', {
          paid: format.money(booking.paid),
          total: format.money(plan.total),
        })}
      </Text>
      {plan.kind === 'installments'
        ? plan.installments.map((installment) => (
            <View key={installment.id} className="flex-row items-center justify-between gap-2">
              <View className="flex-1">
                <Text className="font-body-bold text-body-sm text-foreground">
                  {installment.sequence === 0
                    ? t('booking.plan.deposit')
                    : t('booking.plan.payment', { number: installment.sequence })}
                </Text>
                <Text className="font-body text-caption text-muted">
                  {t('booking.plan.dueBy', { date: format.dateTime(installment.dueAt) })}
                </Text>
              </View>
              <Text className="font-body-bold text-body-sm text-foreground">
                {format.money(installment.amount)}
              </Text>
              <Badge variant={STATE_VARIANT[installment.status]}>
                {t(`booking.plan.states.${installment.status}`)}
              </Badge>
            </View>
          ))
        : null}
      <Text className="font-body text-body-sm text-foreground">
        {t('booking.plan.ticketsAfter')}
      </Text>
      {active ? (
        <View className="gap-2">
          {booking.amountDue ? (
            <Button
              testID="plan-pay-next"
              loading={busy}
              onPress={() => onPay({ payInFull: false })}
            >
              {t('booking.plan.payNext', { amount: format.money(booking.amountDue) })}
            </Button>
          ) : null}
          {pending.length > 1 ? (
            <Button variant="secondary" disabled={busy} onPress={() => onPay({ payInFull: true })}>
              {t('booking.plan.payRest', { amount: format.money(remaining) })}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={busy} onPress={() => setConfirming(true)}>
            {t('booking.plan.cancel')}
          </Button>
        </View>
      ) : null}
      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title={t('booking.plan.cancelTitle')}
        description={
          booking.paid.amountMinor === 0
            ? t('booking.plan.cancelNothingPaid')
            : fee.amountMinor > 0
              ? t('booking.plan.cancelRefundFee', {
                  amount: format.money(afterFee),
                  fee: format.money(fee),
                })
              : t('booking.plan.cancelRefund', { amount: format.money(booking.paid) })
        }
        closeLabel={t('common.close')}
        footer={
          <View className="gap-2">
            <Button
              fullWidth
              loading={busy}
              onPress={() => {
                void onCancel().finally(() => setConfirming(false));
              }}
            >
              {t('booking.plan.cancelConfirm')}
            </Button>
            <Button variant="ghost" onPress={() => setConfirming(false)}>
              {t('booking.plan.cancelKeep')}
            </Button>
          </View>
        }
      />
    </Card>
  );
}

/** Money going back for this booking (ADR-019). */
export function RefundList({ refunds }: { refunds: Booking['refunds'] }) {
  const { t } = useT();
  const format = useFormatters();
  if (refunds.length === 0) return null;
  return (
    <Card className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('booking.refunds.heading')}
      </Text>
      {refunds.map((refund) => (
        <View key={refund.id} className="items-start gap-1">
          <Text className="font-body text-body-sm text-foreground">
            {t('booking.refunds.line', {
              amount: format.money(refund.amount),
              destination: t(`booking.refunds.destinations.${refund.destination}`),
            })}
          </Text>
          <Badge variant={REFUND_VARIANT[refund.status]}>
            {t(`booking.refunds.states.${refund.status}`)}
          </Badge>
        </View>
      ))}
    </Card>
  );
}
