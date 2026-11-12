import { getMessages } from '@suskii/i18n';
import { BRAND } from '@suskii/shared';
import { ImageResponse } from 'next/og';

import { color, ogFonts } from '../lib/og';

export const alt = BRAND.name;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Open Graph card generated at build time from the brand tokens and catalog copy. */
export default async function OpenGraphImage() {
  const { hero } = getMessages('en-NG');
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: color.background,
        fontFamily: 'Plus Jakarta Sans',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 18,
            background: color.primary,
            color: color.surface,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 44,
            fontWeight: 800,
          }}
        >
          S
        </div>
        <div style={{ fontSize: 40, fontWeight: 800, color: color.primary }}>{BRAND.shortName}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ fontSize: 76, fontWeight: 800, color: color.heading, lineHeight: 1.05 }}>
          {hero.headline}
        </div>
        <div style={{ fontSize: 32, fontWeight: 500, color: color.foreground, maxWidth: 960 }}>
          {hero.subheadline}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          height: 12,
          width: 220,
          borderRadius: 6,
          background: color.accent,
        }}
      />
    </div>,
    { ...size, fonts: await ogFonts() },
  );
}
