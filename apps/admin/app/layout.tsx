import { color } from '@suskii/design-tokens';
import { DEFAULT_LOCALE } from '@suskii/shared';
import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { t } from '../lib/i18n';

import { bodyFont, headingFont } from './fonts';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: t('common.appName'), template: `%s | ${t('common.appName')}` },
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: color.primary,
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Every page renders per request so Next.js can stamp the CSP nonce on its scripts (ADR-010).
  await connection();
  return (
    <html lang={DEFAULT_LOCALE} className={`${headingFont.variable} ${bodyFont.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
