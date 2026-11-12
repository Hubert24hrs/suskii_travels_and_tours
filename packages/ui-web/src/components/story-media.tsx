import type { ReactNode } from 'react';

/**
 * Stand-in artwork for stories and tests: a flat, token-coloured panel instead of a photo, so
 * stories stay offline and never ship unlicensed imagery.
 */
export function StoryMedia({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-center justify-center bg-primary-subtle font-heading text-h2 font-bold text-primary">
      {children}
    </div>
  );
}
