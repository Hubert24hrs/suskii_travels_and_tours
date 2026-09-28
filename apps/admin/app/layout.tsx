import { BRAND, DEFAULT_LOCALE } from '@suskii/shared';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { bodyFont, headingFont } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: `${BRAND.shortName} Admin`,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={DEFAULT_LOCALE} className={`${headingFont.variable} ${bodyFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
