#!/usr/bin/env node
/**
 * Builds every brand image from the one logo the owner supplied (brand/suskii-tt-logo.webp,
 * ADR-068): the app icon, Android adaptive icon and splash, and the website and console icons
 * and header mark. Run it after the logo changes and commit what it writes:
 *
 *   node scripts/brand-assets.mjs
 *
 * The source is a 1254 px square: the logo's rounded square on black corners. The corners become
 * transparent (marks) or the logo's red (opaque icons, which the platforms round themselves).
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// sharp ships with Next.js (image optimisation); borrow it rather than add a dependency.
const nextRequire = createRequire(
  createRequire(join(ROOT, 'apps/web/package.json')).resolve('next'),
);
const sharp = nextRequire('sharp');

const SOURCE = join(ROOT, 'brand/suskii-tt-logo.webp');
/** The source's dark rim, trimmed off every side. */
const TRIM = 10;
const SIZE = 1254 - 2 * TRIM;
/** The logo's own corner radius, measured on the source (after the trim). */
const RADIUS = 180;
/** The red at the logo's lower edge, for opaque corners and the adaptive icon background. */
export const LOGO_RED = '#E5200E';

const roundedMask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/></svg>`,
);

/** The logo with transparent corners, full size. */
async function mark() {
  return sharp(SOURCE)
    .extract({ left: TRIM, top: TRIM, width: SIZE, height: SIZE })
    .ensureAlpha()
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function write(buffer, path, size, { opaque = false } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  let image = sharp(buffer).resize(size, size, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (opaque) image = image.flatten({ background: LOGO_RED });
  // A 256-colour palette keeps the gradients and cuts the files to a fraction.
  await image.png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(path);
  process.stdout.write(`${path.slice(ROOT.length + 1)} (${size} px)\n`);
}

/** The mark scaled to `share` of a transparent square, for adaptive icons' safe zone. */
async function padded(markBuffer, size, share) {
  const inner = Math.round(size * share);
  const resized = await sharp(markBuffer).resize(inner, inner).png().toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: resized, gravity: 'center' }])
    .png()
    .toBuffer();
}

const logo = await mark();
// The app (apps/mobile/app.config.ts).
await write(logo, join(ROOT, 'apps/mobile/assets/icon.png'), 1024, { opaque: true });
await write(
  await padded(logo, 1024, 0.8),
  join(ROOT, 'apps/mobile/assets/adaptive-icon.png'),
  1024,
);
await write(logo, join(ROOT, 'apps/mobile/assets/splash-icon.png'), 512);
await write(logo, join(ROOT, 'apps/mobile/assets/logo.png'), 192);
// The website and the console (Next.js metadata files). The tab icon stays small: browsers fetch
// it beside every search, so a 512 px icon would compete with results on a slow network
// (ADR-075). The install manifest gets its own 512 px icon.
for (const app of ['web', 'admin']) {
  await write(logo, join(ROOT, `apps/${app}/app/icon.png`), 48);
  await write(logo, join(ROOT, `apps/${app}/app/apple-icon.png`), 180, { opaque: true });
}
await write(logo, join(ROOT, 'apps/web/public/brand/icon-512.png'), 512);
await write(logo, join(ROOT, 'apps/web/public/brand/logo-mark.png'), 96);
