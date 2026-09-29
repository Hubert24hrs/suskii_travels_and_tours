import { color, fontFamily, fontSize, fontWeight } from '@suskii/design-tokens';

import { seedOf, sequence } from './art-seed';

/**
 * Card illustrations as standalone SVG documents (served from /art, ADR-010). Original artwork
 * built from design tokens, used until licensed photography exists. As images they stay out of
 * the page's HTML and hydration, load lazily and cache, so colours are token values rather than
 * utility classes (page CSS does not reach an <img>).
 */

export const IATA_PAIR = /^([A-Z]{3})-([A-Z]{3})$/;
/** City names as the API returns them: letters (any script), spaces, dots, apostrophes, hyphens. */
export const CITY_NAME = /^[\p{L}][\p{L} .'-]{0,63}$/u;

const svg = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;

const BACKDROPS = [color['primary-subtle'], color.background, color.skeleton] as const;
// Images cannot use the page's web fonts or CSS variables: the system part of the heading stack.
const IMAGE_FONT = fontFamily.web.heading
  .filter((family) => !family.startsWith('var('))
  .join(', ')
  .replaceAll('"', "'");

/** Deal card illustration (16:9): a flight arc over a horizon, varied per route. */
export function routeArtSvg(origin: string, destination: string): string {
  const random = sequence(seedOf(`${origin}-${destination}`));
  const backdrop = BACKDROPS[Math.floor(random() * BACKDROPS.length)] ?? BACKDROPS[0];
  const sunX = 200 + Math.round(random() * 90);
  const sunY = 40 + Math.round(random() * 30);
  const peak = 30 + Math.round(random() * 40);
  const hill = 130 + Math.round(random() * 20);
  return svg(
    320,
    180,
    [
      `<rect width="320" height="180" fill="${backdrop}"/>`,
      `<circle cx="${sunX}" cy="${sunY}" r="22" fill="${color.accent}" opacity="0.4"/>`,
      `<path d="M0 ${hill} C 80 ${hill - 24}, 140 ${hill + 12}, 220 ${hill - 8} S 320 ${hill - 20}, 320 ${hill - 10} V180 H0 Z" fill="${color.surface}"/>`,
      `<path d="M40 138 Q 160 ${peak} 280 96" fill="none" stroke="${color.primary}" opacity="0.7" stroke-width="3" stroke-dasharray="8 8" stroke-linecap="round"/>`,
      `<circle cx="40" cy="138" r="6" fill="${color.primary}"/>`,
      `<circle cx="280" cy="96" r="6" fill="${color.accent}"/>`,
      // `destination` is a validated IATA code (A-Z only), safe to embed as text.
      `<text x="300" y="168" text-anchor="end" fill="${color.primary}" opacity="0.2" font-family="${IMAGE_FONT}" font-size="${fontSize.h2.size}" font-weight="${fontWeight.extrabold}">${destination}</text>`,
    ].join(''),
  );
}

/** Destination card illustration (4:3): a generated skyline at dusk, stable per city. */
export function cityArtSvg(city: string): string {
  const random = sequence(seedOf(city));
  const parts = [`<rect width="320" height="240" fill="${color.primary}"/>`];
  const buildings: string[] = [];
  for (let x = -4; x < 320;) {
    const width = 18 + Math.round(random() * 34);
    const height = 50 + Math.round(random() * 120);
    const tone = random() > 0.5 ? color['primary-pressed'] : color['primary-hover'];
    buildings.push(
      `<rect x="${x}" y="${240 - height}" width="${width}" height="${height}" fill="${tone}"/>`,
    );
    x += width + Math.round(random() * 6);
  }
  const moonX = 40 + Math.round(random() * 240);
  parts.push(`<circle cx="${moonX}" cy="54" r="20" fill="${color.accent}" opacity="0.8"/>`);
  return svg(320, 240, [...parts, ...buildings].join(''));
}
