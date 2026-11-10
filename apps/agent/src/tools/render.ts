import {
  agentCardSchema,
  formatMoney,
  money,
  type AgentCard,
  type StatusFact,
} from '@suskii/shared';

/** A tool result is cut to this before a model reads it: a page of facts, not a database dump. */
export const MODEL_RESULT_MAX_CHARS = 6000;
const STRING_MAX = 500;
const ARRAY_MAX = 20;
const DEPTH_MAX = 6;
const CARD_KEYS = new Set(['card', 'cards']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isMoney = (
  value: Record<string, unknown>,
): value is { amountMinor: number; currency: string } =>
  Object.keys(value).length === 2 &&
  typeof value.amountMinor === 'number' &&
  Number.isSafeInteger(value.amountMinor) &&
  typeof value.currency === 'string' &&
  /^[A-Z]{3}$/.test(value.currency);

/**
 * A tool result as the model reads it. Money becomes the amount a person would read
 * ("NGN 250,000.00"), so the model quotes it and never converts minor units itself; cards are
 * left out (the client draws them, the model does not describe them); long text and long lists
 * are cut.
 */
export function renderForModel(result: unknown): string {
  const text = JSON.stringify(shape(result, 0)) ?? 'null';
  return text.length > MODEL_RESULT_MAX_CHARS
    ? `${text.slice(0, MODEL_RESULT_MAX_CHARS)}… (cut)`
    : text;
}

function shape(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return value.length > STRING_MAX ? `${value.slice(0, STRING_MAX)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (depth >= DEPTH_MAX) return null;
  if (Array.isArray(value))
    return value.slice(0, ARRAY_MAX).map((entry) => shape(entry, depth + 1));
  if (!isRecord(value)) return null;
  if (isMoney(value)) {
    try {
      // Intl puts a no-break space after the currency code; a model should read a plain one.
      return formatMoney(money(value.amountMinor, value.currency), 'en-US').replace(
        /[\u00a0\u202f]/g,
        ' ',
      );
    } catch {
      return null;
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (CARD_KEYS.has(key)) continue;
    out[key] = shape(entry, depth + 1);
  }
  return out;
}

/** The cards a tool result carries, checked: one that does not fit the schema is dropped. */
export function cardsOf(result: unknown): AgentCard[] {
  if (!isRecord(result)) return [];
  const raw = [
    ...(Array.isArray(result.cards) ? (result.cards as unknown[]) : []),
    ...(result.card === undefined ? [] : [result.card]),
  ];
  return raw.flatMap((entry) => {
    const parsed = agentCardSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Every status a result states, with where it sat: what an answer may say happened. */
export function statusFactsOf(result: unknown, prefix = ''): StatusFact[] {
  if (Array.isArray(result)) return result.flatMap((entry) => statusFactsOf(entry, prefix));
  if (!isRecord(result)) return [];
  const facts: StatusFact[] = [];
  for (const [key, value] of Object.entries(result)) {
    if (CARD_KEYS.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string' && /status$/i.test(key)) {
      facts.push({ key: path.toLowerCase(), value: value.toLowerCase() });
    } else if (typeof value === 'object' && value !== null) {
      facts.push(...statusFactsOf(value, path));
    }
  }
  return facts.slice(0, 40);
}
