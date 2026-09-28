import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface TrustBarItem {
  id: string;
  label: string;
  icon: ReactNode;
}

export interface TrustBarProps {
  /** Accessible name for the list, e.g. "Why travellers trust us". */
  label: string;
  /**
   * Items to show. Pass only CMS trust signals with `verified: true`; unverified claims
   * (IATA accreditation, traveller counts) must never reach this component.
   */
  items: readonly TrustBarItem[];
  className?: string;
}

/** Icon + label row: 2x2 grid on mobile, a single row from `md`. */
export function TrustBar({ label, items, className }: TrustBarProps) {
  if (items.length === 0) return null;
  return (
    <ul
      aria-label={label}
      className={cn(
        'grid grid-cols-2 gap-4 md:flex md:flex-wrap md:items-center md:gap-8',
        className,
      )}
    >
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center gap-2 font-body text-body-sm font-medium text-foreground"
        >
          <span aria-hidden="true" className="flex shrink-0 text-primary">
            {item.icon}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
