/** A cancellation tier as the API takes it: days before the start and refund in basis points. */
export interface Tier {
  daysBefore: number;
  refundBps: number;
}

/**
 * Cancellation tiers from text, one per line: "days, refund %" ("2, 90" = 90% back at least two
 * days before). Null when a line does not parse.
 */
export function parsePolicy(text: string): Tier[] | null {
  const tiers: Tier[] = [];
  for (const line of text
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)) {
    const match = /^(\d{1,3})\s*,\s*(\d{1,3}(?:\.\d{1,2})?)$/.exec(line);
    if (!match) return null;
    const percent = Number(match[2]);
    if (percent > 100) return null;
    tiers.push({ daysBefore: Number(match[1]), refundBps: Math.round(percent * 100) });
  }
  return tiers;
}

export const formatPolicy = (tiers: readonly Tier[]): string =>
  tiers.map((tier) => `${tier.daysBefore}, ${tier.refundBps / 100}`).join('\n');
