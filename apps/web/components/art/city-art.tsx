import { cn } from '@suskii/ui-web';
import Image from 'next/image';

/**
 * Destination illustration (4:3), stable per city: an SVG image from /art (lib/art.ts). Lazy by
 * default; `priority` for the one above the fold on a city page. The card's solid scrim keeps text
 * readable on it and on real photos alike (ADR-010).
 */
export function CityArt({
  city,
  priority = false,
  className,
}: {
  city: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={`/art/cities/${encodeURIComponent(city)}.svg`}
      alt=""
      width={320}
      height={240}
      unoptimized
      priority={priority}
      className={cn('block size-full object-cover', className)}
    />
  );
}
