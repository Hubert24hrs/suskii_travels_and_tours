import { Injectable } from '@nestjs/common';

import type { Vertical } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import { FxService } from './fx.service';
import {
  priceOffer,
  type FeeRuleData,
  type MarkupRuleData,
  type PricingContext,
  type PricingResult,
  type PromoData,
  type PromoUsage,
  type SupplierPrice,
} from './pricing-engine';

const RULE_CACHE_MS = 60_000;

export type Pricer = (
  price: SupplierPrice,
  context: PricingContext,
  promo?: { data: PromoData; usage: PromoUsage } | null,
) => PricingResult;

/**
 * Loads pricing rules (cached for a minute: admin edits apply within 60 s) and binds them with one
 * FX snapshot, so a whole result page is priced consistently.
 */
@Injectable()
export class PricingService {
  private readonly cache = new Map<
    Vertical,
    { markups: MarkupRuleData[]; fees: FeeRuleData[]; expires: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  private async rules(
    vertical: Vertical,
  ): Promise<{ markups: MarkupRuleData[]; fees: FeeRuleData[] }> {
    const cached = this.cache.get(vertical);
    if (cached && cached.expires > Date.now()) return cached;
    const [markups, fees] = await Promise.all([
      this.prisma.markupRule.findMany({
        where: { vertical, active: true },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.feeRule.findMany({
        where: { vertical, active: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    const entry = { markups, fees, expires: Date.now() + RULE_CACHE_MS };
    this.cache.set(vertical, entry);
    return entry;
  }

  /** Drops cached rules (called after admin edits and in tests). */
  invalidate(): void {
    this.cache.clear();
  }

  async pricer(vertical: Vertical, displayCurrency: string): Promise<Pricer> {
    const [{ markups, fees }, fx] = await Promise.all([this.rules(vertical), this.fx.converter()]);
    return (price, context, promo) =>
      priceOffer({
        price,
        context,
        displayCurrency,
        markupRules: markups,
        feeRules: fees,
        promo: promo ?? null,
        fx,
      });
  }

  /** A promo code with its usage so far, or null when no such code exists. */
  async findPromo(
    code: string,
    userId: string | null,
  ): Promise<{ data: PromoData; usage: PromoUsage } | null> {
    const data = await this.prisma.promoCode.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    if (!data) return null;
    const [total, byUser] = await Promise.all([
      this.prisma.promoRedemption.count({ where: { promoCodeId: data.id } }),
      userId
        ? this.prisma.promoRedemption.count({ where: { promoCodeId: data.id, userId } })
        : Promise.resolve(0),
    ]);
    return { data, usage: { total, byUser } };
  }
}
