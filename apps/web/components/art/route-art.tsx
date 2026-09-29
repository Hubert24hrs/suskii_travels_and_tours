import { cn } from '@suskii/ui-web';
import Image from 'next/image';

/**
 * Deal card illustration (16:9), varied per route: an SVG image from /art (lib/art.ts), so the
 * artwork stays out of the page's HTML and hydration and loads lazily (ADR-010).
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
  return (
    <Image
      src={`/art/routes/${origin}-${destination}.svg`}
      alt=""
      width={320}
      height={180}
      unoptimized
      className={cn('block size-full object-cover', className)}
    />
  );
}
