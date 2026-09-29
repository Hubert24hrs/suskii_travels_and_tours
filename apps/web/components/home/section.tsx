import { cn } from '@suskii/ui-web';
import type { ReactNode } from 'react';

import { AppLink } from '../app-link';
import { Container } from '../layout/container';

export interface SectionProps {
  id: string;
  title: string;
  /** Optional "See all" style link next to the heading. */
  action?: { href: string; label: string } | undefined;
  className?: string;
  children: ReactNode;
}

/** Homepage section with an h2 that names the landmark. */
export function Section({ id, title, action, className, children }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={cn('py-10 md:py-16', className)}>
      <Container className="flex flex-col gap-6">
        <div className="flex items-end justify-between gap-4">
          <h2 id={`${id}-heading`} className="font-heading text-h2 font-extrabold text-heading">
            {title}
          </h2>
          {action ? (
            <AppLink
              href={action.href}
              className="inline-flex min-h-12 shrink-0 items-center font-body text-body-sm font-bold text-primary hover:underline focus-visible:focus-ring"
            >
              {action.label}
            </AppLink>
          ) : null}
        </div>
        {children}
      </Container>
    </section>
  );
}
