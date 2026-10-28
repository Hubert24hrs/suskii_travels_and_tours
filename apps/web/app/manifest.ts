import { color } from '@suskii/design-tokens';
import { BRAND } from '@suskii/shared';
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.shortName,
    start_url: '/',
    display: 'browser',
    background_color: color.background,
    theme_color: color.primary,
    // Built from the logo by scripts/brand-assets.mjs (ADR-068).
    icons: [
      { src: '/brand/icon-512.png', type: 'image/png', sizes: '512x512' },
      { src: '/apple-icon.png', type: 'image/png', sizes: '180x180' },
    ],
  };
}
