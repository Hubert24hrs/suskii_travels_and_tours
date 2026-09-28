/** Extracts the class names a compiled stylesheet defines (handles escaped selectors). */
export function definedClasses(css: string): Set<string> {
  const classes = new Set<string>();
  for (const match of css.matchAll(/\.((?:\\.|[\w-])+)/g)) {
    if (match[1]) {
      classes.add(match[1].replace(/\\(.)/g, '$1'));
    }
  }
  return classes;
}

/** Utilities every platform must generate from tokens. */
export const TOKEN_CLASSES = [
  'bg-primary',
  'bg-primary-hover',
  'bg-primary-pressed',
  'bg-accent',
  'bg-surface',
  'bg-background',
  'bg-primary-subtle',
  'bg-scrim',
  'bg-skeleton',
  'text-foreground',
  'text-muted',
  'text-heading',
  'text-on-primary',
  'text-on-accent',
  'text-warning-text',
  'border-border',
  'border-border-strong',
  'text-hero',
  'text-hero-mobile',
  'text-h2',
  'text-h3',
  'text-h4',
  'text-body',
  'text-body-sm',
  'text-caption',
  'p-0',
  'p-1',
  'p-3',
  'p-4',
  'px-6',
  'gap-8',
  'm-20',
  'rounded-sm',
  'rounded-md',
  'rounded-lg',
  'rounded-xl',
  'rounded-pill',
  'shadow-primary-button',
  'shadow-card-hover',
  'font-heading',
  'font-body',
  'max-w-page',
  'max-w-popover',
  'max-w-dialog',
  'max-h-menu',
  'text-on-scrim',
  'border-b-3',
] as const;

/** Utilities that must not exist anywhere: Tailwind defaults outside the design system. */
export const FORBIDDEN_CLASSES = [
  'bg-red-500',
  'bg-white',
  'bg-black',
  'text-gray-600',
  'text-sm',
  'text-base',
  'text-2xl',
  'p-7',
  'p-9',
  'm-11',
  'gap-14',
  'rounded-2xl',
  'rounded-3xl',
  'shadow-lg',
  'shadow-md',
  'font-sans',
  'font-serif',
  'max-w-7xl',
] as const;

export const ALL_CANDIDATES = [...TOKEN_CLASSES, ...FORBIDDEN_CLASSES].join(' ');
