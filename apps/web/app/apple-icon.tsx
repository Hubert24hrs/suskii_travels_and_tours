import { ImageResponse } from 'next/og';

import { color, ogFonts } from '../lib/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default async function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color.primary,
        color: color.surface,
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 120,
        fontWeight: 800,
      }}
    >
      S
    </div>,
    { ...size, fonts: await ogFonts() },
  );
}
