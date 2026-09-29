'use client';

import { cn } from '@suskii/ui-web';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Sticky main bar. The utility bar above it scrolls away, and a shadow marks the compact state;
 * the bar's height never changes, so scrolling causes no layout shift.
 */
export function StickyHeader({ children }: { children: ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) =>
      setStuck(entry ? !entry.isIntersecting : false),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="h-px" />
      <header
        data-stuck={stuck || undefined}
        className={cn(
          'sticky top-0 z-30 border-b border-border bg-surface transition-shadow duration-base ease-standard',
          stuck && 'shadow-card-hover',
        )}
      >
        {children}
      </header>
    </>
  );
}
