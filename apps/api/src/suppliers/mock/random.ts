import { createHash } from 'node:crypto';

/** Deterministic PRNG (mulberry32) seeded from any string: same input, same fixtures. */
export class SeededRandom {
  private state: number;

  constructor(seed: string) {
    this.state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  between(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, max: number): number {
    return Math.floor(this.between(min, max + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('pick() needs a non-empty list');
    return item;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

/** Short stable hash for ids. */
export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('|')).digest('base64url').slice(0, 20)}`;
}
