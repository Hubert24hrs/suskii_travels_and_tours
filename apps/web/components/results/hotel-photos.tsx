'use client';

import { cn } from '@suskii/ui-web';
import Image from 'next/image';

import { useResultsT } from './results-messages';

export interface HotelPhoto {
  url: string;
  caption: string | null;
}

/** The demo supplier's drawn pictures: our own `/art/hotels/{seed}-{scene}.svg` (lib/art.ts). */
const OWN_ART = /^\/art\/hotels\/[a-z0-9]{1,32}-(exterior|room|pool|dining)\.svg$/;

interface Shown {
  src: string;
  caption: string | null;
  /** Our own drawing: served as it is. A supplier's photograph goes through the optimiser. */
  drawn: boolean;
}

/**
 * The photos this site may show (ADR-096). Our own drawings are loaded from this origin whatever
 * host the API named; a supplier's photograph only from a host in `IMAGE_REMOTE_HOSTS`, which is
 * also what the image optimiser and the CSP allow. Anything else is left out, never linked.
 */
export function shownPhotos(photos: readonly HotelPhoto[], hosts: readonly string[]): Shown[] {
  return photos.flatMap((photo): Shown[] => {
    let url: URL;
    try {
      url = new URL(photo.url);
    } catch {
      return [];
    }
    if (OWN_ART.test(url.pathname)) {
      return [{ src: url.pathname, caption: photo.caption, drawn: true }];
    }
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname)) return [];
    return [{ src: url.href, caption: photo.caption, drawn: false }];
  });
}

/** One picture for a result card; nothing when the hotel has none this site may show. */
export function HotelThumb({
  photo,
  hosts,
  className,
}: {
  photo: HotelPhoto | null;
  hosts: readonly string[];
  className?: string;
}) {
  const [shown] = photo ? shownPhotos([photo], hosts) : [];
  if (!shown) return null;
  return (
    <div
      className={cn('aspect-video overflow-hidden rounded-lg bg-skeleton', className)}
      data-testid="hotel-photo"
    >
      {/* Decorative beside the hotel's name: the gallery on the hotel page names each photo. */}
      <Image
        src={shown.src}
        alt=""
        width={320}
        height={240}
        sizes="(min-width: 768px) 25vw, 100vw"
        unoptimized={shown.drawn}
        className="block size-full object-cover"
      />
    </div>
  );
}

/**
 * A hotel's photos as a strip that scrolls sideways with the keyboard, a pointer or a finger.
 * Every picture is named for screen readers ("Palm Hotel: photo 2 of 4", then its caption).
 */
export function PhotoGallery({
  hotel,
  photos,
  hosts,
  sample,
}: {
  hotel: string;
  photos: readonly HotelPhoto[];
  hosts: readonly string[];
  /** Demo data: the pictures are drawings, and the page says so. */
  sample: boolean;
}) {
  const { t } = useResultsT();
  const shown = shownPhotos(photos, hosts);
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="hotel-photos-title" className="flex flex-col gap-2">
      <h2 id="hotel-photos-title" className="sr-only">
        {t('results.stayContent.photos')}
      </h2>
      {/* Focusable so the strip scrolls with the arrow keys. */}
      <ul
        tabIndex={0}
        aria-labelledby="hotel-photos-title"
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-lg pb-2 focus-visible:focus-ring"
        data-testid="hotel-gallery"
      >
        {shown.map((photo, index) => {
          const name = t('results.stayContent.photoAlt', {
            hotel,
            number: index + 1,
            total: shown.length,
          });
          return (
            <li
              key={photo.src}
              className="aspect-4/3 w-4/5 shrink-0 snap-start overflow-hidden rounded-lg bg-skeleton sm:w-1/2 lg:w-1/3"
            >
              <Image
                src={photo.src}
                alt={photo.caption ? `${name}. ${photo.caption}` : name}
                width={640}
                height={480}
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 80vw"
                unoptimized={photo.drawn}
                priority={index === 0}
                className="block size-full object-cover"
              />
            </li>
          );
        })}
      </ul>
      {sample ? (
        <p className="font-body text-caption text-foreground">
          {t('results.stayContent.samplePhotos')}
        </p>
      ) : null}
    </section>
  );
}
