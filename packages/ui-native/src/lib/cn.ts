import { tailwindMergeTheme } from '@suskii/design-tokens';
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge must know the token names, or `text-h2` (size) and `text-primary` (colour)
// look like conflicting colour classes and one gets dropped.
const twMerge = extendTailwindMerge({ override: { theme: tailwindMergeTheme } });

/** Joins class names and resolves Tailwind conflicts (later classes win). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
