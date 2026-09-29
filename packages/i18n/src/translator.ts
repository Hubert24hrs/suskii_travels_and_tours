/**
 * A small, typed translator. Catalog leaves are strings with `{name}` placeholders or plural
 * forms (`{ one: '{count} hotel', other: '{count} hotels' }`, optional `zero`), selected with
 * `Intl.PluralRules`. Keys are checked at compile time against the catalog shape.
 */

export type PluralMessage = { readonly other: string } & Readonly<
  Partial<Record<Intl.LDMLPluralRule, string>>
>;

export interface MessageTree {
  readonly [key: string]: string | PluralMessage | MessageTree;
}

/** Dot paths to every leaf ("search.flights.submit"). */
export type MessageKey<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends PluralMessage
      ? K
      : `${K}.${MessageKey<T[K]>}`;
}[keyof T & string];

export type MessageValues = Readonly<Record<string, string | number>>;

export interface Translator<T> {
  readonly locale: string;
  /** Plural messages need a numeric `count` value. Unknown keys return the key itself. */
  readonly t: (key: MessageKey<T>, values?: MessageValues) => string;
}

const isPlural = (value: unknown): value is PluralMessage =>
  typeof value === 'object' && value !== null && typeof (value as PluralMessage).other === 'string';

function lookup(messages: MessageTree, key: string): unknown {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

export function createTranslator<T extends MessageTree>(
  messages: T,
  locale: string,
): Translator<T> {
  const plurals = new Intl.PluralRules(locale);
  const numbers = new Intl.NumberFormat(locale);
  const interpolate = (template: string, values: MessageValues | undefined): string =>
    values
      ? template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
          const value = values[name];
          if (value === undefined) return placeholder;
          return typeof value === 'number' ? numbers.format(value) : value;
        })
      : template;

  return {
    locale,
    t: (key, values) => {
      const entry = lookup(messages, key);
      if (typeof entry === 'string') return interpolate(entry, values);
      if (isPlural(entry)) {
        const count = values?.count;
        const form =
          typeof count !== 'number'
            ? entry.other
            : count === 0 && entry.zero !== undefined
              ? entry.zero
              : (entry[plurals.select(count)] ?? entry.other);
        return interpolate(form, values);
      }
      return key;
    },
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };
export type MessageOverlay<T> = DeepPartial<T>;

/** Applies a regional overlay (for example American spelling) on top of the base catalog. */
export function mergeMessages<T extends MessageTree>(base: T, overlay: MessageOverlay<T>): T {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay as Record<string, unknown>)) {
    const current = result[key];
    result[key] =
      typeof value === 'object' && value !== null && typeof current === 'object' && current !== null
        ? mergeMessages(current as MessageTree, value as MessageOverlay<MessageTree>)
        : value;
  }
  return result as T;
}
