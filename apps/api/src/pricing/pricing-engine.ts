import {
  add,
  compare,
  isNegative,
  maxOf,
  minOf,
  money,
  multiply,
  percentageOf,
  subtract,
  sum,
  zero,
  type Money,
} from '@suskii/shared';

import type {
  CabinClass,
  FeeRule,
  MarkupRule,
  PromoCode,
  SalesChannel,
  UserTier,
  Vertical,
} from '../generated/prisma/client';

import type { Converter } from './fx.service';

/** Everything a rule can match on. Null means "unknown" and only matches rules that ignore it. */
export interface PricingContext {
  vertical: Vertical;
  supplier: string;
  channel: SalesChannel | null;
  userTier: UserTier;
  originCode?: string | null;
  destinationCode?: string | null;
  originCountry?: string | null;
  destinationCountry?: string | null;
  carrierCode?: string | null;
  cabinClass?: CabinClass | null;
  /** Travellers that per-passenger fees apply to (passengers or hotel guests). */
  passengers: number;
  now: Date;
}

/** What the supplier charges us, in one currency. */
export interface SupplierPrice {
  base: Money;
  taxes: Money;
}

export type MarkupRuleData = Pick<
  MarkupRule,
  | 'id'
  | 'priority'
  | 'active'
  | 'vertical'
  | 'channel'
  | 'userTier'
  | 'supplier'
  | 'originCode'
  | 'destinationCode'
  | 'originCountry'
  | 'destinationCountry'
  | 'carrierCode'
  | 'cabinClass'
  | 'type'
  | 'value'
  | 'currency'
  | 'minAmountMinor'
  | 'maxAmountMinor'
  | 'validFrom'
  | 'validTo'
>;

export type FeeRuleData = Pick<
  FeeRule,
  | 'id'
  | 'code'
  | 'label'
  | 'sortOrder'
  | 'active'
  | 'vertical'
  | 'channel'
  | 'userTier'
  | 'type'
  | 'value'
  | 'currency'
  | 'basis'
  | 'minAmountMinor'
  | 'maxAmountMinor'
  | 'validFrom'
  | 'validTo'
>;

export type PromoData = Pick<
  PromoCode,
  | 'id'
  | 'code'
  | 'type'
  | 'value'
  | 'currency'
  | 'maxDiscountMinor'
  | 'minSpendMinor'
  | 'verticals'
  | 'validFrom'
  | 'validTo'
  | 'maxRedemptions'
  | 'maxRedemptionsPerUser'
  | 'requiresAccount'
  | 'active'
>;

export interface PromoUsage {
  total: number;
  byUser: number;
}

export type PromoRejection =
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'vertical'
  | 'account_required'
  | 'min_spend'
  | 'exhausted'
  | 'user_limit';

export interface PriceBreakdown {
  currency: string;
  /** Supplier base fare plus markup, in the display currency. */
  fare: Money;
  taxes: Money;
  fees: { code: string; label: string; amount: Money }[];
  discount: { code: string; amount: Money } | null;
  total: Money;
  /** Internal: never sent to customers (response schemas omit it). */
  markup: { ruleId: string; amount: Money } | null;
  supplierTotal: Money;
  fx: { from: string; to: string; rate: string; asOf: string; provider: string } | null;
}

export interface PricingResult {
  breakdown: PriceBreakdown;
  promo: { status: 'applied' } | { status: 'rejected'; reason: PromoRejection } | null;
}

export interface PricingInput {
  price: SupplierPrice;
  context: PricingContext;
  displayCurrency: string;
  /** Sorted by priority ascending; the first match wins. */
  markupRules: readonly MarkupRuleData[];
  feeRules: readonly FeeRuleData[];
  promo?: { data: PromoData; usage: PromoUsage } | null;
  fx: Converter;
}

interface Validity {
  active: boolean;
  validFrom: Date | null;
  validTo: Date | null;
}

export function isInForce(rule: Validity, now: Date): boolean {
  if (!rule.active) return false;
  if (rule.validFrom && now < rule.validFrom) return false;
  return !(rule.validTo && now >= rule.validTo);
}

const matches = <T>(condition: T | null | undefined, actual: T | null | undefined): boolean =>
  condition === null || condition === undefined || condition === actual;

export function markupMatches(rule: MarkupRuleData, ctx: PricingContext): boolean {
  return (
    rule.vertical === ctx.vertical &&
    isInForce(rule, ctx.now) &&
    matches(rule.channel, ctx.channel) &&
    matches(rule.userTier, ctx.userTier) &&
    matches(rule.supplier, ctx.supplier) &&
    matches(rule.originCode, ctx.originCode) &&
    matches(rule.destinationCode, ctx.destinationCode) &&
    matches(rule.originCountry, ctx.originCountry) &&
    matches(rule.destinationCountry, ctx.destinationCountry) &&
    matches(rule.carrierCode, ctx.carrierCode) &&
    matches(rule.cabinClass, ctx.cabinClass)
  );
}

export function feeMatches(rule: FeeRuleData, ctx: PricingContext): boolean {
  return (
    rule.vertical === ctx.vertical &&
    isInForce(rule, ctx.now) &&
    matches(rule.channel, ctx.channel) &&
    matches(rule.userTier, ctx.userTier)
  );
}

/** Minor units in the rule's currency (or `fallback`), converted to `target`. */
function ruleAmount(
  minor: bigint,
  currency: string | null,
  fallback: string,
  target: string,
  fx: Converter,
): Money {
  return fx.convert(money(minor, currency ?? fallback), target, 'half-up');
}

function clamp(
  amount: Money,
  rule: { minAmountMinor: bigint | null; maxAmountMinor: bigint | null; currency: string | null },
  fx: Converter,
): Money {
  let result = amount;
  if (rule.minAmountMinor !== null) {
    result = maxOf(
      result,
      ruleAmount(rule.minAmountMinor, rule.currency, amount.currency, amount.currency, fx),
    );
  }
  if (rule.maxAmountMinor !== null) {
    result = minOf(
      result,
      ruleAmount(rule.maxAmountMinor, rule.currency, amount.currency, amount.currency, fx),
    );
  }
  return result;
}

export function checkPromo(
  promo: PromoData,
  usage: PromoUsage,
  ctx: PricingContext,
  spend: Money,
  fx: Converter,
): PromoRejection | null {
  if (!promo.active) return 'inactive';
  if (promo.validFrom && ctx.now < promo.validFrom) return 'not_started';
  if (promo.validTo && ctx.now >= promo.validTo) return 'expired';
  if (promo.verticals.length > 0 && !promo.verticals.includes(ctx.vertical)) return 'vertical';
  if (promo.requiresAccount && ctx.userTier === 'guest') return 'account_required';
  if (promo.maxRedemptions !== null && usage.total >= promo.maxRedemptions) return 'exhausted';
  if (promo.maxRedemptionsPerUser !== null && usage.byUser >= promo.maxRedemptionsPerUser)
    return 'user_limit';
  if (promo.minSpendMinor !== null) {
    const minimum = ruleAmount(
      promo.minSpendMinor,
      promo.currency,
      spend.currency,
      spend.currency,
      fx,
    );
    if (compare(spend, minimum) < 0) return 'min_spend';
  }
  return null;
}

/**
 * Prices one supplier offer for a customer:
 *   1. markup: first matching rule (percentage of the supplier base, or fixed), clamped to caps;
 *   2. convert fare (base + markup) and taxes into the display currency, line by line;
 *   3. fees: every matching rule, per booking or per passenger, clamped to caps;
 *   4. promo: percentage or fixed off fare + fees (never taxes), capped, never below zero;
 *   5. total = fare + taxes + fees - discount, which holds exactly by construction.
 */
export function priceOffer(input: PricingInput): PricingResult {
  const { price, context: ctx, displayCurrency, fx } = input;
  const supplierCurrency = price.base.currency;

  let markup: Money = zero(supplierCurrency);
  let markupRuleId: string | null = null;
  const rule = input.markupRules.find((candidate) => markupMatches(candidate, ctx));
  if (rule) {
    const raw =
      rule.type === 'percentage'
        ? percentageOf(price.base, rule.value, 'half-up')
        : ruleAmount(rule.value, rule.currency, supplierCurrency, supplierCurrency, fx);
    markup = clamp(raw, rule, fx);
    markupRuleId = rule.id;
  }
  // A negative markup (a channel discount) can never push the fare below zero.
  const supplierFare = maxOf(add(price.base, markup), zero(supplierCurrency));

  const fare = fx.convert(supplierFare, displayCurrency, 'half-up');
  const taxes = fx.convert(price.taxes, displayCurrency, 'half-up');

  const fees = input.feeRules
    .filter((candidate) => feeMatches(candidate, ctx))
    .map((feeRule) => {
      const unit =
        feeRule.type === 'percentage'
          ? percentageOf(add(fare, taxes), feeRule.value, 'half-up')
          : ruleAmount(feeRule.value, feeRule.currency, displayCurrency, displayCurrency, fx);
      const perBasis =
        feeRule.basis === 'per_passenger' ? multiply(unit, Math.max(ctx.passengers, 1)) : unit;
      const amount = clamp(perBasis, feeRule, fx);
      return {
        code: feeRule.code,
        label: feeRule.label,
        amount: isNegative(amount) ? zero(displayCurrency) : amount,
      };
    });
  const feeTotal = sum(
    displayCurrency,
    fees.map((fee) => fee.amount),
  );
  const discountable = add(fare, feeTotal);

  let discount: PriceBreakdown['discount'] = null;
  let promoResult: PricingResult['promo'] = null;
  if (input.promo) {
    const { data, usage } = input.promo;
    const reason = checkPromo(data, usage, ctx, add(discountable, taxes), fx);
    if (reason) {
      promoResult = { status: 'rejected', reason };
    } else {
      let amount =
        data.type === 'percentage'
          ? percentageOf(discountable, data.value, 'floor')
          : ruleAmount(data.value, data.currency, displayCurrency, displayCurrency, fx);
      if (data.maxDiscountMinor !== null) {
        amount = minOf(
          amount,
          ruleAmount(data.maxDiscountMinor, data.currency, displayCurrency, displayCurrency, fx),
        );
      }
      amount = maxOf(minOf(amount, discountable), zero(displayCurrency));
      discount = { code: data.code, amount };
      promoResult = { status: 'applied' };
    }
  }

  const subtotal = add(add(fare, taxes), feeTotal);
  const total = discount ? subtract(subtotal, discount.amount) : subtotal;

  return {
    breakdown: {
      currency: displayCurrency,
      fare,
      taxes,
      fees,
      discount,
      total,
      markup: markupRuleId
        ? { ruleId: markupRuleId, amount: fx.convert(markup, displayCurrency, 'half-up') }
        : null,
      supplierTotal: add(price.base, price.taxes),
      fx: fx.describe(supplierCurrency, displayCurrency),
    },
    promo: promoResult,
  };
}
