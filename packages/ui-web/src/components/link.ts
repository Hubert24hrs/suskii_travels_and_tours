import type { ElementType, ReactNode } from 'react';

/**
 * Link component contract for cards: defaults to `<a>`, and Next.js apps pass `next/link`.
 * Kept structural so ui-web never imports a framework.
 */
export type LinkComponent = ElementType<{ href: string; className?: string; children?: ReactNode }>;
