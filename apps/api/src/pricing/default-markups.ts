import { stableDefaultMarkupId } from '../catalog/reference-ids';
import type { PrismaClient, Vertical } from '../generated/prisma/client';

/**
 * The owner's markups (ADR-124), in basis points of the supplier's price before its taxes, as
 * every markup rule is (taxes are passed on as they are): 2% on flight fares, and 10% on hotels,
 * on Cars (buses, rides and rental cars) and on everything else Suskii sells. A Prime membership
 * is Suskii's own price per country (ADR-082) and takes none.
 *
 * A record over every vertical: a new vertical does not compile until it has a decision here.
 */
export const DEFAULT_MARKUP_BPS: Readonly<Record<Vertical, number | null>> = {
  flights: 200,
  hotels: 1_000,
  buses: 1_000,
  rides: 1_000,
  rentals: 1_000,
  packages: 1_000,
  tours: 1_000,
  visa: 1_000,
  travel_addons: 1_000,
  assisted: 1_000,
  prime: null,
};

/**
 * The lowest precedence a markup rule can have (the console allows 0 to 10,000, lowest number
 * first): any rule staff add for a route, a supplier, a channel or a cabin wins over a default.
 */
export const DEFAULT_MARKUP_PRIORITY = 10_000;

export const DEFAULT_MARKUP_NAME = 'Default markup (ADR-124)';

/** The default rules, one per vertical that takes a markup, under their fixed ids. */
export function defaultMarkupRules(): {
  id: string;
  vertical: Vertical;
  valueBps: number;
}[] {
  return (Object.entries(DEFAULT_MARKUP_BPS) as [Vertical, number | null][]).flatMap(
    ([vertical, valueBps]) =>
      valueBps === null ? [] : [{ id: stableDefaultMarkupId(vertical), vertical, valueBps }],
  );
}

/**
 * Creates each default markup rule once (the reference seed runs this on every release). A rule
 * that exists is never updated or created again: staff change a default's value, its scope or
 * switch it off in the console (audited, with step-up), and the next release keeps what they set.
 * Markup rules are never deleted (the console only switches them off), so a default staff
 * switched off stays off. Returns how many rules this run created.
 */
export async function seedDefaultMarkups(
  prisma: Pick<PrismaClient, 'markupRule'>,
): Promise<number> {
  let created = 0;
  for (const rule of defaultMarkupRules()) {
    const existing = await prisma.markupRule.findUnique({
      where: { id: rule.id },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.markupRule.upsert({
      where: { id: rule.id },
      create: {
        id: rule.id,
        name: DEFAULT_MARKUP_NAME,
        vertical: rule.vertical,
        priority: DEFAULT_MARKUP_PRIORITY,
        active: true,
        type: 'percentage',
        value: BigInt(rule.valueBps),
      },
      // Two releases seeding at once: the second leaves the first one's rule as it is.
      update: {},
    });
    created += 1;
  }
  return created;
}
