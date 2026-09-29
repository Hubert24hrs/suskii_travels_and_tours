import { cn } from '@suskii/ui-web';

import { seedOf, sequence } from './seed';

/**
 * Destination card illustration (4:3): a generated skyline at dusk, stable per city. The card's
 * solid scrim keeps text readable on it and on real photos alike (ADR-010).
 */
export function CityArt({ city, className }: { city: string; className?: string }) {
  const random = sequence(seedOf(city));
  const buildings: { x: number; width: number; height: number; tone: string }[] = [];
  for (let x = -4; x < 320;) {
    const width = 18 + Math.round(random() * 34);
    const height = 50 + Math.round(random() * 120);
    buildings.push({
      x,
      width,
      height,
      tone: random() > 0.5 ? 'fill-primary-pressed' : 'fill-primary-hover',
    });
    x += width + Math.round(random() * 6);
  }
  const moonX = 40 + Math.round(random() * 240);
  return (
    <svg
      viewBox="0 0 320 240"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className={cn('block size-full', className)}
    >
      <rect width="320" height="240" className="fill-primary" />
      <circle cx={moonX} cy="54" r="20" className="fill-accent opacity-80" />
      {buildings.map((building) => (
        <rect
          key={building.x}
          x={building.x}
          y={240 - building.height}
          width={building.width}
          height={building.height}
          className={building.tone}
        />
      ))}
    </svg>
  );
}
