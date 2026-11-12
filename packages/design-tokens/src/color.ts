/** An sRGB colour with 0-255 channels and 0-1 alpha. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGBA = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+))?\s*\)$/i;

/** Parses `#rgb`, `#rrggbb`, `rgb(r, g, b)` and `rgba(r, g, b, a)`. Throws on anything else. */
export function parseColor(value: string): Rgba {
  const hex = HEX.exec(value.trim());
  if (hex?.[1]) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = RGBA.exec(value.trim());
  if (rgba) {
    const [r, g, b] = [rgba[1], rgba[2], rgba[3]].map(Number) as [number, number, number];
    if ([r, g, b].some((channel) => channel > 255)) {
      throw new Error(`Colour channel out of range: ${value}`);
    }
    return { r, g, b, a: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  }
  throw new Error(`Unsupported colour format: ${value}`);
}

/** Alpha-composites `foreground` over an opaque `background` (source-over). */
export function composite(foreground: Rgba, background: Rgba): Rgba {
  if (background.a !== 1) {
    throw new Error('Background must be opaque to composite onto');
  }
  const mix = (fg: number, bg: number): number => fg * foreground.a + bg * (1 - foreground.a);
  return {
    r: mix(foreground.r, background.r),
    g: mix(foreground.g, background.g),
    b: mix(foreground.b, background.b),
    a: 1,
  };
}

const linearise = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance of an opaque colour. */
export function relativeLuminance({ r, g, b, a }: Rgba): number {
  if (a !== 1) {
    throw new Error('Composite translucent colours before measuring luminance');
  }
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/**
 * WCAG 2.x contrast ratio (1 to 21). Translucent foregrounds are composited over the
 * background first, which is how they render.
 */
export function contrastRatio(foreground: string, background: string): number {
  const bg = parseColor(background);
  const fg = composite(parseColor(foreground), bg);
  const [lighter, darker] = [relativeLuminance(fg), relativeLuminance(bg)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Returns `color` composited over `background` as an opaque `rgb(...)` string. */
export function flatten(color: string, background: string): string {
  const { r, g, b } = composite(parseColor(color), parseColor(background));
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}
