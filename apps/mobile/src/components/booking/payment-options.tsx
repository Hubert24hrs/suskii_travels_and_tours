import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Card } from '@suskii/ui-native';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useT } from '../../providers/app-provider';

export type PlanChoiceValue = 'full' | 'hold' | 'installments';
type Options = Schemas['PaymentOptions'];
export type ProviderName = Options['providers'][number]['name'];

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

/** Pay now, reserve and pay later, or installments, as the fare allows and never with extras. */
export function PlanChoice({
  vertical = 'flights',
  options,
  value,
  onChange,
  extrasSelected,
}: {
  /** Packages hold our own places (ADR-028); other in-house products issue a voucher. */
  vertical?: Schemas['Quote']['vertical'];
  options: Options;
  value: PlanChoiceValue;
  onChange: (value: PlanChoiceValue) => void;
  extrasSelected: boolean;
}) {
  const { t } = useT();
  const format = useFormatters();
  if (!options.hold && !options.installments) return null;
  const hold = extrasSelected ? null : options.hold;
  const installments = extrasSelected ? null : options.installments;
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
          {value === 'installments' ? <InstallmentSchedule installments={installments} /> : null}
        </Radio>
      ) : null}
      {extrasSelected ? (
        <Text className="font-body text-body-sm text-foreground">
          {t('checkout.plan.notWithExtras')}
        </Text>
      ) : null}
    </Card>
  );
}

/** The payment providers for this currency, when there is a choice (ADR-016). */
export function MethodChoice({
  providers,
  value,
  onChange,
}: {
  providers: Options['providers'];
  value: ProviderName | null;
  onChange: (provider: ProviderName) => void;
}) {
  const { t } = useT();
  if (providers.length < 2) return null;
  const selected = value ?? providers[0]?.name;
  return (
    <Card className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('checkout.method.heading')}
      </Text>
      {providers.map((provider) => (
        <Radio
          key={provider.name}
          label={t(`checkout.method.names.${provider.name}`)}
          checked={selected === provider.name}
          onPress={() => onChange(provider.name)}
        />
      ))}
    </Card>
  );
}
