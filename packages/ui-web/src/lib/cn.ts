import { clsx, type ClassValue } from 'clsx';

/**
 * Token names of the design system (packages/design-tokens). Only names travel to the browser;
 * `cn.node.test.ts` fails when they drift from the tokens.
 */
export const TOKEN_NAMES = {
  color: [
    'primary',
    'primary-hover',
    'primary-pressed',
    'accent',
    'accent-hover',
    'background',
    'surface',
    'heading',
    'foreground',
    'muted',
    'border',
    'success',
    'warning',
    'danger',
    'focus-ring',
    'on-primary',
    'on-accent',
    'on-status',
    'border-strong',
    'focus',
    'warning-text',
    'primary-subtle',
    'scrim',
    'on-scrim',
    'overlay',
    'skeleton',
  ],
  text: ['hero', 'hero-mobile', 'h2', 'h3', 'h4', 'body', 'body-sm', 'caption'],
  font: ['heading', 'body', 'heading-extrabold', 'body-medium', 'body-bold'],
  'font-weight': ['regular', 'medium', 'bold', 'extrabold'],
} as const;

const words = (list: readonly string[]): string => list.join('|');
const COLOR = `(?:${words(TOKEN_NAMES.color)}|inherit|current|transparent)`;

/**
 * Utility families of this design system and the families each one overrides. Tailwind's default
 * palette and scales are removed (ADR-003), so a small table covers every class the apps use;
 * `cn.node.test.ts` checks it against tailwind-merge on every class in the source tree.
 */
const GROUPS: [group: string, pattern: RegExp][] = [
  [
    'display',
    /^(?:block|inline-block|inline|flex|inline-flex|grid|inline-grid|table|contents|flow-root|list-item|hidden)$/,
  ],
  ['position', /^(?:static|fixed|absolute|relative|sticky)$/],
  ['visibility', /^(?:visible|invisible|collapse)$/],
  ['sr', /^(?:sr-only|not-sr-only)$/],
  ['inset', /^inset-(?![xy](?:-|$))./],
  ['inset-x', /^inset-x-./],
  ['inset-y', /^inset-y-./],
  ['top', /^top-/],
  ['right', /^right-/],
  ['bottom', /^bottom-/],
  ['left', /^left-/],
  ['z', /^z-/],
  ['order', /^order-/],
  ['grid-cols', /^grid-cols-/],
  ['grid-rows', /^grid-rows-/],
  ['col', /^col-(?:span-|auto$)/],
  ['col-start', /^col-start-/],
  ['col-end', /^col-end-/],
  ['row', /^row-(?:span-|auto$)/],
  ['flex', /^flex-(?:\d+|auto|initial|none)$/],
  ['flex-direction', /^flex-(?:row|col)(?:-reverse)?$/],
  ['flex-wrap', /^flex-(?:wrap|wrap-reverse|nowrap)$/],
  ['grow', /^grow(?:-\d+)?$/],
  ['shrink', /^shrink(?:-\d+)?$/],
  ['basis', /^basis-/],
  ['justify-content', /^justify-(?:start|end|center|between|around|evenly|stretch|normal)$/],
  ['justify-items', /^justify-items-/],
  ['justify-self', /^justify-self-/],
  ['align-content', /^content-(?:start|end|center|between|around|evenly|stretch|normal|baseline)$/],
  ['align-items', /^items-/],
  ['align-self', /^self-/],
  ['gap', /^gap-(?![xy](?:-|$))./],
  ['gap-x', /^gap-x-./],
  ['gap-y', /^gap-y-./],
  ['space-x', /^space-x-/],
  ['space-y', /^space-y-/],
  ['p', /^p-/],
  ['px', /^px-/],
  ['py', /^py-/],
  ['ps', /^ps-/],
  ['pe', /^pe-/],
  ['pt', /^pt-/],
  ['pr', /^pr-/],
  ['pb', /^pb-/],
  ['pl', /^pl-/],
  ['m', /^m-/],
  ['mx', /^mx-/],
  ['my', /^my-/],
  ['ms', /^ms-/],
  ['me', /^me-/],
  ['mt', /^mt-/],
  ['mr', /^mr-/],
  ['mb', /^mb-/],
  ['ml', /^ml-/],
  ['size', /^size-/],
  ['w', /^w-/],
  ['min-w', /^min-w-/],
  ['max-w', /^max-w-/],
  ['h', /^h-/],
  ['min-h', /^min-h-/],
  ['max-h', /^max-h-/],
  [
    'font-weight',
    new RegExp(`^font-(?:${words(TOKEN_NAMES['font-weight'])}|thin|light|normal|semibold|black)$`),
  ],
  ['font-family', new RegExp(`^font-(?:${words(TOKEN_NAMES.font)}|sans|serif|mono)$`)],
  ['font-size', new RegExp(`^text-(?:${words(TOKEN_NAMES.text)})$`)],
  ['text-color', new RegExp(`^text-${COLOR}$`)],
  ['text-align', /^text-(?:left|center|right|justify|start|end)$/],
  ['text-wrap', /^text-(?:wrap|nowrap|balance|pretty)$/],
  ['text-overflow', /^(?:truncate|text-ellipsis|text-clip)$/],
  ['font-style', /^(?:italic|not-italic)$/],
  ['text-transform', /^(?:uppercase|lowercase|capitalize|normal-case)$/],
  ['text-decoration', /^(?:underline|overline|line-through|no-underline)$/],
  ['underline-offset', /^underline-offset-/],
  ['decoration-color', new RegExp(`^decoration-${COLOR}$`)],
  ['leading', /^leading-/],
  ['tracking', /^tracking-/],
  ['line-clamp', /^line-clamp-/],
  ['vertical-align', /^align-(?:baseline|top|middle|bottom|text-top|text-bottom|sub|super)$/],
  ['fvn-normal', /^normal-nums$/],
  ['fvn-spacing', /^(?:proportional-nums|tabular-nums)$/],
  ['fvn-figure', /^(?:lining-nums|oldstyle-nums)$/],
  ['whitespace', /^whitespace-/],
  ['break', /^break-(?:normal|words|all|keep)$/],
  ['list-style', /^list-(?:none|disc|decimal)$/],
  ['bg-color', new RegExp(`^bg-${COLOR}$`)],
  ['border-w', /^border(?:-\d+)?$/],
  ['border-w-x', /^border-x(?:-\d+)?$/],
  ['border-w-y', /^border-y(?:-\d+)?$/],
  ['border-w-t', /^border-t(?:-\d+)?$/],
  ['border-w-r', /^border-r(?:-\d+)?$/],
  ['border-w-b', /^border-b(?:-\d+)?$/],
  ['border-w-l', /^border-l(?:-\d+)?$/],
  ['border-style', /^border-(?:solid|dashed|dotted|double|hidden|none)$/],
  ['border-collapse', /^border-(?:collapse|separate)$/],
  ['border-color', new RegExp(`^border-${COLOR}$`)],
  ['border-color-x', new RegExp(`^border-x-${COLOR}$`)],
  ['border-color-y', new RegExp(`^border-y-${COLOR}$`)],
  ['border-color-t', new RegExp(`^border-t-${COLOR}$`)],
  ['border-color-r', new RegExp(`^border-r-${COLOR}$`)],
  ['border-color-b', new RegExp(`^border-b-${COLOR}$`)],
  ['border-color-l', new RegExp(`^border-l-${COLOR}$`)],
  ['divide-x', /^divide-x(?:-\d+)?$/],
  ['divide-y', /^divide-y(?:-\d+)?$/],
  ['divide-color', new RegExp(`^divide-${COLOR}$`)],
  ['rounded', /^rounded(?:-(?:none|sm|md|lg|xl|pill|full))?$/],
  ['rounded-t', /^rounded-t(?:-|$)/],
  ['rounded-r', /^rounded-r(?:-|$)/],
  ['rounded-b', /^rounded-b(?:-|$)/],
  ['rounded-l', /^rounded-l(?:-|$)/],
  ['shadow', /^shadow(?:-(?:primary-button|card-hover|none))?$/],
  ['opacity', /^opacity-/],
  ['overflow', /^overflow-(?![xy](?:-|$))./],
  ['overflow-x', /^overflow-x-./],
  ['overflow-y', /^overflow-y-./],
  ['overscroll', /^overscroll-/],
  ['snap-type', /^snap-(?:none|x|y|both)$/],
  ['snap-strictness', /^snap-(?:mandatory|proximity)$/],
  ['snap-align', /^snap-(?:start|end|center|align-none)$/],
  ['scroll-p', /^scroll-p-./],
  ['scroll-px', /^scroll-px-./],
  ['scroll-py', /^scroll-py-./],
  ['cursor', /^cursor-/],
  ['pointer-events', /^pointer-events-/],
  ['select', /^select-/],
  ['appearance', /^appearance-/],
  ['accent', new RegExp(`^accent-${COLOR}$`)],
  ['outline', /^outline(?:-none)?$/],
  ['transition', /^transition(?:-(?:all|colors|opacity|shadow|transform|none))?$/],
  ['duration', /^duration-/],
  ['ease', /^ease-/],
  ['delay', /^delay-/],
  ['animate', /^animate-/],
  ['translate-x', /^translate-x-/],
  ['translate-y', /^translate-y-/],
  ['rotate', /^rotate-/],
  ['scale', /^scale-/],
  ['aspect', /^aspect-/],
  ['object-fit', /^object-(?:contain|cover|fill|none|scale-down)$/],
  ['fill', new RegExp(`^fill-(?:${COLOR}|none)$`)],
  ['stroke', new RegExp(`^stroke-(?:${COLOR}|none)$`)],
  ['stroke-w', /^stroke-\d+$/],
  ['focus-ring', /^focus-ring$/],
];

const OVERRIDES: Record<string, string[]> = {
  inset: ['inset-x', 'inset-y', 'top', 'right', 'bottom', 'left'],
  'inset-x': ['right', 'left'],
  'inset-y': ['top', 'bottom'],
  gap: ['gap-x', 'gap-y'],
  p: ['px', 'py', 'ps', 'pe', 'pt', 'pr', 'pb', 'pl'],
  px: ['pr', 'pl'],
  py: ['pt', 'pb'],
  m: ['mx', 'my', 'ms', 'me', 'mt', 'mr', 'mb', 'ml'],
  mx: ['mr', 'ml'],
  my: ['mt', 'mb'],
  size: ['w', 'h'],
  'font-size': ['leading'],
  flex: ['grow', 'shrink', 'basis'],
  'fvn-normal': ['fvn-spacing', 'fvn-figure'],
  'scroll-p': ['scroll-px', 'scroll-py'],
  'border-w': ['border-w-x', 'border-w-y', 'border-w-t', 'border-w-r', 'border-w-b', 'border-w-l'],
  'border-w-x': ['border-w-r', 'border-w-l'],
  'border-w-y': ['border-w-t', 'border-w-b'],
  rounded: ['rounded-t', 'rounded-r', 'rounded-b', 'rounded-l'],
  overflow: ['overflow-x', 'overflow-y'],
  'border-color': [
    'border-color-x',
    'border-color-y',
    'border-color-t',
    'border-color-r',
    'border-color-b',
    'border-color-l',
  ],
  'border-color-x': ['border-color-r', 'border-color-l'],
  'border-color-y': ['border-color-t', 'border-color-b'],
};

const groupCache = new Map<string, string | null>();

function groupOf(utility: string): string | null {
  const cached = groupCache.get(utility);
  if (cached !== undefined) return cached;
  const base = utility.startsWith('-') ? utility.slice(1) : utility;
  const group = GROUPS.find(([, pattern]) => pattern.test(base))?.[0] ?? null;
  groupCache.set(utility, group);
  return group;
}

/** `md:hover:p-4` → variants `hover:md:` (order-insensitive between arbitrary variants). */
function split(token: string): { variants: string; utility: string; important: boolean } {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === '[') depth += 1;
    else if (char === ']') depth -= 1;
    else if (char === ':' && depth === 0) {
      parts.push(token.slice(start, index));
      start = index + 1;
    }
  }
  let utility = token.slice(start);
  let important = false;
  if (utility.startsWith('!')) {
    important = true;
    utility = utility.slice(1);
  } else if (utility.endsWith('!')) {
    important = true;
    utility = utility.slice(0, -1);
  }
  // Arbitrary variants keep their place; the plain ones between them are sorted.
  const sorted: string[] = [];
  let run: string[] = [];
  for (const part of parts) {
    if (part.startsWith('[')) {
      sorted.push(...run.sort(), part);
      run = [];
    } else run.push(part);
  }
  sorted.push(...run.sort());
  return { variants: sorted.join(':'), utility, important };
}

/**
 * Joins class names and resolves conflicts between this design system's utilities: of two classes
 * in the same family (and the same variants), the later one wins, and a shorthand (`p-4`) drops
 * the longhands it covers (`px-2`) that come before it. Unknown classes are always kept.
 */
export function cn(...inputs: ClassValue[]): string {
  const tokens = clsx(inputs).split(' ').filter(Boolean);
  const taken = new Set<string>();
  const kept: string[] = [];
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    const { variants, utility, important } = split(token);
    const group = groupOf(utility);
    if (group === null) {
      kept.push(token);
      continue;
    }
    const scope = `${variants}${important ? '!' : ''}:`;
    if (taken.has(scope + group)) continue;
    taken.add(scope + group);
    for (const overridden of OVERRIDES[group] ?? []) taken.add(scope + overridden);
    kept.push(token);
  }
  return kept.reverse().join(' ');
}
