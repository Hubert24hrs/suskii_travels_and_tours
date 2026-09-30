'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Card } from '@suskii/ui-web';
import type { ReactNode } from 'react';

import type { Schemas } from '../../lib/browser-api';

import { useBookingT } from './checkout-messages';

export type PaymentPlanChoice = 'full' | 'hold' | 'installments';
type Options = Schemas['PaymentOptions'];
export type ProviderName = Options['providers'][number]['name'];

function Choice({
  id,
  name,
  checked,
  onSelect,
  label,
  hint,
  children,
}: {
  id: string;
  name: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-strong p-3 has-checked:border-primary">
      <label htmlFor={id} className="flex items-start gap-3 font-body text-body text-foreground">
        <input
          id={id}
          type="radio"
          name={name}
          checked={checked}
          onChange={onSelect}
          className="mt-1 size-5 shrink-0 accent-primary"
        />
        <span className="flex flex-col gap-1">
          <span className="font-bold">{label}</span>
          {hint ? <span className="text-body-sm">{hint}</span> : null}
        </span>
      </label>
      {children}
    </div>
  );
}

/** The schedule, fee and missed-payment policy, shown before anything is committed (ADR-018). */
export function InstallmentSchedule({
  installments,
}: {
  installments: NonNullable<Options['installments']>;
}) {
  const { t } = useBookingT();
  const format = useFormatters();
  return (
    <div className="flex flex-col gap-2" data-testid="installment-schedule">
      <p className="font-body text-body-sm font-bold text-foreground">
        {t('checkout.plan.schedule')}
      </p>
      <ol className="flex flex-col gap-1">
        {installments.schedule.map((payment) => (
          <li
            key={payment.sequence}
            className="flex justify-between gap-4 font-body text-body-sm text-foreground"
          >
            <span>
              {payment.sequence === 0
                ? t('checkout.plan.depositDue')
                : t('checkout.plan.dueBy', { date: format.dateTime(payment.dueAt) })}
            </span>
            <span className="font-bold">{format.money(payment.amount)}</span>
          </li>
        ))}
      </ol>
      <p className="font-body text-body-sm text-foreground">
        {installments.fee.amountMinor > 0
          ? t('checkout.plan.fee', { amount: format.money(installments.fee) })
          : t('checkout.plan.noFee')}
        {' · '}
        {t('checkout.plan.planTotal', { amount: format.money(installments.total) })}
      </p>
      <p className="font-body text-body-sm text-foreground">
        {installments.defaultFeeBps === 0
          ? t('checkout.plan.policyRefund')
          : t('checkout.plan.policyFee', { percent: installments.defaultFeeBps / 100 })}
      </p>
    </div>
  );
}

/**
 * Pay now, reserve and pay later, or installments (ADR-018). Only what the airline allows for
 * this fare is offered, never with paid extras; the full schedule, total, fee and missed-payment
 * policy are shown before the traveller commits.
 */
export function PlanChoice({
  options,
  value,
  onChange,
  extrasSelected,
}: {
  options: Options;
  value: PaymentPlanChoice;
  onChange: (plan: PaymentPlanChoice) => void;
  extrasSelected: boolean;
}) {
  const { t } = useBookingT();
  const format = useFormatters();
  if (!options.hold && !options.installments) return null;
  const hold = extrasSelected ? null : options.hold;
  const installments = extrasSelected ? null : options.installments;
  return (
    <Card asChild className="flex flex-col gap-3 p-4">
      <fieldset>
        <legend className="mb-2 font-heading text-h4 font-bold text-heading">
          {t('checkout.plan.heading')}
        </legend>
        <Choice
          id="plan-full"
          name="payment-plan"
          checked={value === 'full'}
          onSelect={() => onChange('full')}
          label={t('checkout.plan.full')}
          hint={t('checkout.plan.fullHint')}
        />
        {hold ? (
          <Choice
            id="plan-hold"
            name="payment-plan"
            checked={value === 'hold'}
            onSelect={() => onChange('hold')}
            label={t('checkout.plan.hold')}
            hint={t('checkout.plan.holdHint', { deadline: format.dateTime(hold.deadline) })}
          />
        ) : null}
        {installments ? (
          <Choice
            id="plan-installments"
            name="payment-plan"
            checked={value === 'installments'}
            onSelect={() => onChange('installments')}
            label={t('checkout.plan.installments')}
            hint={t('checkout.plan.installmentsHint', { count: installments.schedule.length })}
          >
            {value === 'installments' ? (
              <>
                <InstallmentSchedule installments={installments} />
                <p className="font-body text-caption text-foreground">
                  {t('checkout.plan.estimate')}
                </p>
              </>
            ) : null}
          </Choice>
        ) : null}
        {extrasSelected ? (
          <p className="font-body text-body-sm text-foreground">
            {t('checkout.plan.notWithExtras')}
          </p>
        ) : null}
      </fieldset>
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
  const { t } = useBookingT();
  if (providers.length < 2) return null;
  const selected = value ?? providers[0]?.name;
  return (
    <Card asChild className="flex flex-col gap-3 p-4">
      <fieldset>
        <legend className="mb-2 font-heading text-h4 font-bold text-heading">
          {t('checkout.method.heading')}
        </legend>
        {providers.map((provider) => (
          <Choice
            key={provider.name}
            id={`method-${provider.name}`}
            name="payment-method"
            checked={selected === provider.name}
            onSelect={() => onChange(provider.name)}
            label={t(`checkout.method.names.${provider.name}`)}
          />
        ))}
      </fieldset>
    </Card>
  );
}
