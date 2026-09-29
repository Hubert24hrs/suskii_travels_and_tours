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
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/apple-icon', type: 'image/png', sizes: '180x180' },
    ],
  };
}
