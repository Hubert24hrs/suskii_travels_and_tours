/**
 * JSON that round-trips `bigint` (money minor units) as `{ "$big": "123" }`. Used for Redis
 * caches and JSON columns that hold domain objects.
 */
export function stringifyWithBigInt(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? { $big: item.toString() } : item,
  );
}

export function parseWithBigInt<T>(text: string): T {
  return JSON.parse(text, (_key, item: unknown) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      const big = record.$big;
      if (typeof big === 'string' && Object.keys(record).length === 1 && /^-?\d+$/.test(big)) {
        return BigInt(big);
      }
    }
    return item;
  }) as T;
}

/** A plain JSON value (for Prisma Json columns) with bigints encoded. */
export function toJsonValue<T>(value: T): unknown {
  return JSON.parse(stringifyWithBigInt(value));
}

export function fromJsonValue<T>(value: unknown): T {
  return parseWithBigInt<T>(JSON.stringify(value));
}
