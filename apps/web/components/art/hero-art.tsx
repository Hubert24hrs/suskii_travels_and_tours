import { cn } from '@suskii/ui-web';

/** Light hero illustration for large screens: a globe with flight paths (decorative). */
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 360"
      aria-hidden="true"
      focusable="false"
      className={cn('block h-auto w-full', className)}
    >
      <circle cx="260" cy="190" r="150" className="fill-primary-subtle" />
      <ellipse
        cx="260"
        cy="190"
        rx="150"
        ry="56"
        className="fill-none stroke-surface"
        strokeWidth="3"
      />
      <ellipse
        cx="260"
        cy="190"
        rx="62"
        ry="150"
        className="fill-none stroke-surface"
        strokeWidth="3"
      />
      <path d="M110 190 H410" className="stroke-surface" strokeWidth="3" />
      <path
        d="M70 250 Q 200 40 400 110"
        className="fill-none stroke-primary"
        strokeWidth="4"
        strokeDasharray="10 10"
        strokeLinecap="round"
      />
      <path
        d="M120 300 Q 280 220 440 250"
        className="fill-none stroke-accent"
        strokeWidth="4"
        strokeDasharray="10 10"
        strokeLinecap="round"
      />
      <circle cx="70" cy="250" r="9" className="fill-primary" />
      <circle cx="400" cy="110" r="9" className="fill-accent" />
      <circle cx="440" cy="250" r="9" className="fill-primary" />
      <path
        d="M392 96 l22 -6 l-8 14 l4 10 l-6 2 l-6 -8 l-12 4 l-2 -4 l10 -6 z"
        className="fill-primary"
      />
    </svg>
  );
}
