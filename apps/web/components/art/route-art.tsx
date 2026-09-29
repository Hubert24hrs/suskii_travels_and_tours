import { cn } from '@suskii/ui-web';

import { seedOf, sequence } from './seed';

const BACKDROPS = ['fill-primary-subtle', 'fill-background', 'fill-skeleton'] as const;

/**
 * Deal card illustration (16:9): a flight arc over a horizon, varied per route. Original artwork
 * built from design tokens, used until licensed photography exists (ADR-010).
 */
export function RouteArt({
  origin,
  destination,
  className,
}: {
  origin: string;
  destination: string;
  className?: string;
}) {
  const random = sequence(seedOf(`${origin}-${destination}`));
  const backdrop = BACKDROPS[Math.floor(random() * BACKDROPS.length)] ?? BACKDROPS[0];
  const sunX = 200 + Math.round(random() * 90);
  const sunY = 40 + Math.round(random() * 30);
  const peak = 30 + Math.round(random() * 40);
  const hill = 130 + Math.round(random() * 20);
  return (
    <svg
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className={cn('block size-full', className)}
    >
      <rect width="320" height="180" className={backdrop} />
      <circle cx={sunX} cy={sunY} r="22" className="fill-accent opacity-40" />
      <path
        d={`M0 ${hill} C 80 ${hill - 24}, 140 ${hill + 12}, 220 ${hill - 8} S 320 ${hill - 20}, 320 ${hill - 10} V180 H0 Z`}
        className="fill-surface"
      />
      <path
        d={`M40 138 Q 160 ${peak} 280 96`}
        className="fill-none stroke-primary opacity-70"
        strokeWidth="3"
        strokeDasharray="8 8"
        strokeLinecap="round"
      />
      <circle cx="40" cy="138" r="6" className="fill-primary" />
      <circle cx="280" cy="96" r="6" className="fill-accent" />
      <text
        x="300"
        y="168"
        textAnchor="end"
        className="fill-primary font-heading text-h2 font-extrabold opacity-20"
      >
        {destination}
      </text>
    </svg>
  );
}
