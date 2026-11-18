import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Card } from '@suskii/ui-native';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useT } from '../../providers/app-provider';

export type PlanChoiceValue = 'full' | 'hold' | 'installments';
type Options = Schemas['PaymentOptions'];
type Installments = NonNullable<Options['installments']>;
export type PaymentMethodName = Options['methods'][number]['method'];

function Radio({
  label,
  hint,
  checked,
  onPress,
  children,
  testID,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onPress: () => void;
  children?: ReactNode;
  testID?: string;
}) {
  return (
    <View
      className={
        checked
          ? 'gap-3 rounded-md border-2 border-primary p-3'
          : 'gap-3 rounded-md border border-border-strong p-3'
      }
    >
      <Pressable
        testID={testID}
        accessibilityRole="radio"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        onPress={onPress}
        className="min-h-12 flex-row items-start gap-3"
      >
        <View className="mt-1 size-5 items-center justify-center rounded-pill border-2 border-primary">
          {checked ? <View className="size-2 rounded-pill bg-primary" /> : null}
        </View>
        <View className="flex-1 gap-1">
          <Text className="font-body-bold text-body text-foreground">{label}</Text>
          {hint ? <Text className="font-body text-body-sm text-foreground">{hint}</Text> : null}
        </View>
      </Pressable>
      {children}
    </View>
  );
}

/** Schedule, fee and missed-payment policy, shown before anything is committed (ADR-018). */
export function InstallmentSchedule({
  installments,
}: {
  installments: NonNullable<Options['installments']>;
}) {
  const { t } = useT();
  const format = useFormatters();
  return (
    <View testID="installment-schedule" className="gap-2">
      <Text className="font-body-bold text-body-sm text-foreground">
        {t('checkout.plan.schedule')}
      </Text>
      {installments.schedule.map((payment) => (
        <View key={payment.sequence} className="flex-row justify-between gap-4">
          <Text className="font-body text-body-sm text-foreground">
            {payment.sequence === 0
              ? t('checkout.plan.depositDue')
              : t('checkout.plan.dueBy', { date: format.dateTime(payment.dueAt) })}
          </Text>
          <Text className="font-body-bold text-body-sm text-foreground">
            {format.money(payment.amount)}
          </Text>
        </View>
      ))}
      <Text className="font-body text-body-sm text-foreground">
        {installments.fee.amountMinor > 0
          ? t('checkout.plan.fee', { amount: format.money(installments.fee) })
          : t('checkout.plan.noFee')}{' '}
        · {t('checkout.plan.planTotal', { amount: format.money(installments.total) })}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {installments.defaultFeeBps === 0
          ? t('checkout.plan.policyRefund')
          : t('checkout.plan.policyFee', { percent: installments.defaultFeeBps / 100 })}
      </Text>
    </View>
  );
}

/**
 * The plan for the number of payments after the deposit the traveller chose (ADR-124), or the
 * one with as many as fit when they have not chosen (or chose a number no longer on offer).
 */
export function chosenInstallments(
  installments: Installments,
  payments: number | null,
): { plan: Installments; payments: number | null } {
  const choice = installments.choices.find((option) => option.payments === payments);
  if (!choice) return { plan: installments, payments: null };
  return {
    plan: { ...installments, total: choice.total, fee: choice.fee, schedule: choice.schedule },
    payments: choice.payments,
  };
}

/** How many payments follow the deposit, like a repayment term (ADR-124). */
function PaymentsChoice({
  installments,
  payments,
  onChange,
}: {
  installments: Installments;
  payments: number | null;
  onChange: (payments: number) => void;
}) {
  const { t } = useT();
  const selected = payments ?? installments.schedule.length - 1;
  return (
    <View testID="installment-payments" className="gap-2">
      <Text className="font-body-bold text-body-sm text-foreground">
        {t('checkout.plan.payments')}
      </Text>
      <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
        {installments.choices.map((choice) => {
          const checked = selected === choice.payments;
          const label = t('checkout.plan.paymentsOption', { count: choice.payments });
          return (
            <Pressable
              key={choice.payments}
              testID={`plan-payments-${String(choice.payments)}`}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              accessibilityLabel={label}
              onPress={() => onChange(choice.payments)}
              className={
                checked
                  ? 'min-h-12 justify-center rounded-md border-2 border-primary px-3'
                  : 'min-h-12 justify-center rounded-md border border-border-strong px-3'
              }
            >
              <Text className="font-body text-body-sm text-foreground">{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="font-body text-caption text-foreground">
        {t('checkout.plan.paymentsHint')}
      </Text>
    </View>
  );
}

/**
 * Pay now, reserve and pay later, or installments, as the fare allows and never with extras. With
 * installments, the traveller chooses how many payments follow the deposit (ADR-124).
 */
export function PlanChoice({
  vertical = 'flights',
  options,
  value,
  onChange,
  payments = null,
  onPaymentsChange,
  extrasSelected,
  seatsSelected = false,
}: {
  /** Packages hold our own places (ADR-028); other in-house products issue a voucher. */
  vertical?: Schemas['Quote']['vertical'];
  options: Options;
  value: PlanChoiceValue;
  onChange: (value: PlanChoiceValue) => void;
  /** Payments after the deposit the traveller chose; null for as many as fit. */
  payments?: number | null;
  onPaymentsChange?: (payments: number) => void;
  extrasSelected: boolean;
  /** Chosen seats (ADR-094): they rule out reserving and installments, as bags do. */
  seatsSelected?: boolean;
}) {
  const { t } = useT();
  const format = useFormatters();
  if (!options.hold && !options.installments) return null;
  const hold = extrasSelected ? null : options.hold;
  const offered = extrasSelected ? null : options.installments;
  const installments = offered ? chosenInstallments(offered, payments).plan : null;
  return (
    <Card className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('checkout.plan.heading')}
      </Text>
      <Radio
        testID="plan-full"
        label={t('checkout.plan.full')}
        hint={
          vertical === 'flights' || vertical === 'hotels'
            ? t('checkout.plan.fullHint')
            : t('checkout.plan.fullHintVoucher')
        }
        checked={value === 'full'}
        onPress={() => onChange('full')}
      />
      {hold ? (
        <Radio
          testID="plan-hold"
          label={t('checkout.plan.hold')}
          hint={t(
            vertical === 'packages' ? 'checkout.plan.holdHintPackage' : 'checkout.plan.holdHint',
            { deadline: format.dateTime(hold.deadline) },
          )}
          checked={value === 'hold'}
          onPress={() => onChange('hold')}
        />
      ) : null}
      {installments ? (
        <Radio
          testID="plan-installments"
          label={t('checkout.plan.installments')}
          hint={t(
            vertical === 'packages'
              ? 'checkout.plan.installmentsHintPackage'
              : 'checkout.plan.installmentsHint',
            { count: installments.schedule.length },
          )}
          checked={value === 'installments'}
          onPress={() => onChange('installments')}
        >
          {value === 'installments' ? (
            <>
              {offered && offered.choices.length > 1 && onPaymentsChange ? (
                <PaymentsChoice
                  installments={offered}
                  payments={chosenInstallments(offered, payments).payments}
                  onChange={onPaymentsChange}
                />
              ) : null}
              <InstallmentSchedule installments={installments} />
            </>
          ) : null}
        </Radio>
      ) : null}
      {extrasSelected ? (
        <Text className="font-body text-body-sm text-foreground">
          {t(seatsSelected ? 'checkout.seats.notWithPlans' : 'checkout.plan.notWithExtras')}
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * The method to send: the traveller's pick, else the first one listed; null when there is no
 * choice to make, so the provider's page shows everything it offers (ADR-074).
 */
export function chosenMethod(
  methods: Options['methods'],
  value: PaymentMethodName | null,
): PaymentMethodName | null {
  if (methods.length < 2) return null;
  if (value && methods.some((option) => option.method === value)) return value;
  return methods[0]?.method ?? null;
}

/** How to pay in this currency (card, transfer, USSD, mobile money, wallets, agent; ADR-074). */
export function MethodChoice({
  methods,
  value,
  onChange,
}: {
  methods: Options['methods'];
  value: PaymentMethodName | null;
  onChange: (method: PaymentMethodName) => void;
}) {
  const { t } = useT();
  const selected = chosenMethod(methods, value);
  if (!selected) return null;
  return (
    <Card className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('checkout.method.heading')}
      </Text>
      {methods.map((option) => (
        <Radio
          key={option.method}
          testID={`method-${option.method}`}
          label={t(`checkout.method.names.${option.method}`)}
          hint={
            selected === option.method ? t(`checkout.method.hints.${option.method}`) : undefined
          }
          checked={selected === option.method}
          onPress={() => onChange(option.method)}
        />
      ))}
    </Card>
  );
}
