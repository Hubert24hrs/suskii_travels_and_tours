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

/** Sample hotel pictures: `{seed}-{scene}`, the seed in lower-case letters and digits. */
export const HOTEL_ART = /^([a-z0-9]{1,32})-(exterior|room|pool|dining)$/;
export type HotelScene = 'exterior' | 'room' | 'pool' | 'dining';

/**
 * Sample hotel pictures (4:3), stable per hotel and scene, for the demo supplier's hotels: real
 * suppliers send photographs (ADR-096). Drawn, not photographed, so nobody mistakes one for the
 * real place.
 */
export function hotelArtSvg(seed: string, scene: HotelScene): string {
  const random = sequence(seedOf(`${seed}-${scene}`));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const sky = pick([color['primary-subtle'], color.background, color.skeleton]);
  const parts: string[] = [`<rect width="320" height="240" fill="${sky}"/>`];
  if (scene === 'exterior') {
    const sunX = 40 + Math.round(random() * 240);
    parts.push(`<circle cx="${sunX}" cy="48" r="22" fill="${color.accent}" opacity="0.7"/>`);
    const floors = 4 + Math.floor(random() * 4);
    const width = 150 + Math.round(random() * 60);
    const left = Math.round((320 - width) / 2);
    const top = 210 - floors * 26;
    parts.push(
      `<rect x="${left}" y="${top}" width="${width}" height="${210 - top}" fill="${color.heading}"/>`,
      `<rect x="${left - 8}" y="${top - 8}" width="${width + 16}" height="10" fill="${color['primary-pressed']}"/>`,
    );
    const columns = Math.floor(width / 26);
    const gap = (width - columns * 14) / (columns + 1);
    for (let floor = 0; floor < floors; floor += 1) {
      for (let column = 0; column < columns; column += 1) {
        const lit = random() > 0.35;
        parts.push(
          `<rect x="${Math.round(left + gap + column * (14 + gap))}" y="${top + 8 + floor * 26}" width="14" height="14" fill="${lit ? color.accent : color.surface}" opacity="${lit ? 0.95 : 0.35}"/>`,
        );
      }
    }
    parts.push(
      `<rect x="150" y="186" width="20" height="24" fill="${color.surface}"/>`,
      `<rect y="210" width="320" height="30" fill="${color.border}"/>`,
    );
  } else if (scene === 'room') {
    parts.push(
      `<rect y="170" width="320" height="70" fill="${color.border}"/>`,
      `<rect x="${24 + Math.round(random() * 20)}" y="36" width="90" height="70" fill="${color.surface}" stroke="${color['border-strong']}" stroke-width="3"/>`,
      `<circle cx="${60 + Math.round(random() * 30)}" cy="62" r="12" fill="${color.accent}" opacity="0.7"/>`,
      `<rect x="130" y="96" width="160" height="34" rx="6" fill="${color.heading}"/>`,
      `<rect x="130" y="124" width="160" height="56" rx="6" fill="${color.surface}" stroke="${color.border}" stroke-width="2"/>`,
      `<rect x="130" y="150" width="160" height="30" rx="6" fill="${pick([color.primary, color['primary-hover'], color.heading])}"/>`,
      `<rect x="142" y="110" width="50" height="22" rx="6" fill="${color.surface}"/>`,
      `<rect x="228" y="110" width="50" height="22" rx="6" fill="${color.surface}"/>`,
      `<rect x="134" y="180" width="8" height="14" fill="${color['border-strong']}"/>`,
      `<rect x="278" y="180" width="8" height="14" fill="${color['border-strong']}"/>`,
      `<rect x="96" y="150" width="24" height="44" fill="${color['border-strong']}"/>`,
      `<path d="M100 150 L108 124 L116 150 Z" fill="${color.accent}"/>`,
    );
  } else if (scene === 'pool') {
    const sunX = 40 + Math.round(random() * 240);
    parts.push(
      `<circle cx="${sunX}" cy="44" r="24" fill="${color.accent}" opacity="0.8"/>`,
      `<rect y="120" width="320" height="120" fill="${color.border}"/>`,
      `<path d="M30 150 H290 L310 226 H10 Z" fill="${color.heading}" opacity="0.85"/>`,
    );
    for (let wave = 0; wave < 4; wave += 1) {
      const y = 166 + wave * 14;
      const x = 40 + Math.round(random() * 60);
      parts.push(
        `<path d="M${x} ${y} q 14 -8 28 0 t 28 0 t 28 0" fill="none" stroke="${color.surface}" stroke-width="3" opacity="0.6" stroke-linecap="round"/>`,
      );
    }
    const palm = 30 + Math.round(random() * 40);
    parts.push(
      `<rect x="${palm}" y="70" width="8" height="64" fill="${color['border-strong']}"/>`,
      `<path d="M${palm + 4} 72 q -34 -22 -52 4 M${palm + 4} 72 q 34 -22 52 4 M${palm + 4} 72 q -10 -38 -40 -32 M${palm + 4} 72 q 10 -38 40 -32" fill="none" stroke="${color.success}" stroke-width="7" stroke-linecap="round"/>`,
      `<rect x="${220 + Math.round(random() * 30)}" y="126" width="56" height="10" rx="4" fill="${color.primary}"/>`,
    );
  } else {
    parts.push(
      `<rect y="176" width="320" height="64" fill="${color.border}"/>`,
      `<rect x="20" y="30" width="280" height="50" fill="${color.surface}" stroke="${color['border-strong']}" stroke-width="3"/>`,
    );
    for (let lamp = 0; lamp < 3; lamp += 1) {
      const x = 70 + lamp * 90;
      parts.push(
        `<rect x="${x - 1}" y="0" width="2" height="24" fill="${color['border-strong']}"/>`,
        `<path d="M${x - 14} 40 L${x} 22 L${x + 14} 40 Z" fill="${color.accent}"/>`,
      );
    }
    for (let table = 0; table < 3; table += 1) {
      const x = 60 + table * 100 + Math.round(random() * 10);
      parts.push(
        `<ellipse cx="${x}" cy="150" rx="34" ry="10" fill="${color.surface}" stroke="${color.border}" stroke-width="2"/>`,
        `<rect x="${x - 3}" y="150" width="6" height="40" fill="${color['border-strong']}"/>`,
        `<rect x="${x - 44}" y="140" width="14" height="46" rx="4" fill="${pick([color.primary, color.heading])}"/>`,
        `<rect x="${x + 30}" y="140" width="14" height="46" rx="4" fill="${pick([color.primary, color.heading])}"/>`,
        `<circle cx="${x}" cy="143" r="5" fill="${color.accent}"/>`,
      );
    }
  }
  return svg(320, 240, parts.join(''));
}
