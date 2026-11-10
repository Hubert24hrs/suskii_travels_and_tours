'use client';

import { useFormatters } from '@suskii/i18n/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { Schemas } from '../../lib/browser-api';

import { useResultsT } from './results-messages';

type Hotel = Schemas['HotelSummary'];

/** The drawing's own units: pins are placed in a 100 by 75 box, whatever size it is shown at. */
const WIDTH = 100;
const HEIGHT = 75;
const MARGIN = 8;
/** A pin's radius on screen, in CSS pixels: 28 across, above the 24 a target needs (ADR-088). */
const PIN_PIXELS = 14;
/** The width assumed until the drawing is measured: the narrowest screen we support. */
const NARROW_PIXELS = 320;

/**
 * Where each hotel sits in the drawing: east to the right, north up, distances true to each
 * other (a degree of longitude is shorter away from the equator).
 */
export function pinPositions(
  hotels: readonly Pick<Hotel, 'id' | 'latitude' | 'longitude'>[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (hotels.length === 0) return positions;
  const middle = hotels.reduce((sum, hotel) => sum + hotel.latitude, 0) / hotels.length;
  const shrink = Math.cos((middle * Math.PI) / 180);
  const points = hotels.map((hotel) => ({
    id: hotel.id,
    east: hotel.longitude * shrink,
    north: hotel.latitude,
  }));
  const east = points.map((point) => point.east);
  const north = points.map((point) => point.north);
  const [west, south] = [Math.min(...east), Math.min(...north)];
  const span = Math.max(Math.max(...east) - west, Math.max(...north) - south, 1e-6);
  const scale = Math.min(WIDTH - 2 * MARGIN, HEIGHT - 2 * MARGIN) / span;
  const offsetX = (WIDTH - (Math.max(...east) - west) * scale) / 2;
  const offsetY = (HEIGHT - (Math.max(...north) - south) * scale) / 2;
  for (const point of points) {
    positions.set(point.id, {
      x: Math.round((offsetX + (point.east - west) * scale) * 10) / 10,
      y: Math.round((HEIGHT - offsetY - (point.north - south) * scale) * 10) / 10,
    });
  }
  return positions;
}

/**
 * The hotels of a results page as pins (ADR-097). It shows where they are in relation to each
 * other, not streets: no map tiles are loaded, so nothing is sent to a map provider. A pin is a
 * button; the chosen hotel is handed to `onSelect` and shown by the results under the drawing.
 * The list view stays the complete alternative.
 */
export default function HotelMap({
  hotels,
  selected,
  onSelect,
}: {
  hotels: readonly Hotel[];
  selected: string | null;
  onSelect: (hotelId: string) => void;
}) {
  const { t } = useResultsT();
  const format = useFormatters();
  const [focused, setFocused] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [pixels, setPixels] = useState(NARROW_PIXELS);
  // The drawing scales with the page; its pins must not, or a wide screen hides them under
  // each other. The measured width turns the pin's size on screen into the drawing's units.
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) setPixels(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const pin = (PIN_PIXELS * WIDTH) / pixels;
  const positions = pinPositions(hotels);
  const press = (event: KeyboardEvent, hotelId: string): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect(hotelId);
  };
  // The chosen pin is drawn last, so it is never hidden under a neighbour.
  const ordered = [...hotels].sort((a, b) => Number(a.id === selected) - Number(b.id === selected));
  return (
    <div ref={frame} className="flex flex-col gap-2" data-testid="hotel-map">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-label={t('results.map.heading')}
        className="w-full rounded-lg border border-border bg-primary-subtle"
      >
        {ordered.map((hotel) => {
          const position = positions.get(hotel.id);
          if (!position) return null;
          const chosen = hotel.id === selected;
          return (
            <g
              key={hotel.id}
              role="button"
              tabIndex={0}
              aria-pressed={chosen}
              aria-label={t('results.map.pin', {
                hotel: hotel.name,
                price: format.money(hotel.cheapestRate.price.total),
              })}
              onClick={() => onSelect(hotel.id)}
              onKeyDown={(event) => press(event, hotel.id)}
              onFocus={() => setFocused(hotel.id)}
              onBlur={() => setFocused(null)}
              className="cursor-pointer outline-none"
              data-testid={`hotel-pin-${hotel.id}`}
            >
              {focused === hotel.id ? (
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={pin * 1.4}
                  className="fill-none stroke-focus"
                  strokeWidth={pin * 0.25}
                />
              ) : null}
              <circle
                cx={position.x}
                cy={position.y}
                r={pin}
                className={chosen ? 'fill-primary stroke-surface' : 'fill-surface stroke-primary'}
                strokeWidth={pin * 0.2}
              />
              <circle
                cx={position.x}
                cy={position.y}
                r={pin * 0.3}
                className={chosen ? 'fill-surface' : 'fill-primary'}
              />
            </g>
          );
        })}
      </svg>
      <p className="font-body text-caption text-foreground">{t('results.map.note')}</p>
    </div>
  );
}
