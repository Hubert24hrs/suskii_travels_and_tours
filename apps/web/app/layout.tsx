import { color } from '@suskii/design-tokens';
import { I18nProvider } from '@suskii/i18n/react';
import { BRAND } from '@suskii/shared';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { SiteFooter } from '../components/layout/site-footer';
import { SiteHeader, UtilityBar } from '../components/layout/site-header';
import { WebVitalsReporter } from '../components/web-vitals-reporter';
import { api } from '../lib/api';
import { publicEnv } from '../lib/env';
import { getI18n, type ErrorMessages } from '../lib/i18n';

import { bodyFont, headingFont } from './fonts';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    metadataBase: new URL(publicEnv.siteUrl),
    title: {
      default: t('seo.homeTitle', { brand: BRAND.shortName }),
      template: `%s | ${BRAND.shortName}`,
    },
    description: t('seo.homeDescription'),
    applicationName: BRAND.shortName,
    openGraph: { siteName: BRAND.shortName, type: 'website' },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: color.primary,
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { locale, t, messages } = await getI18n();
  const site = await api.site(locale);
  const errorMessages: ErrorMessages = { pages: { error: messages.pages.error } };
  return (
    <html lang={locale} className={`${headingFont.variable} ${bodyFont.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 bg-surface px-4 py-3 font-body font-bold text-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus-visible:focus-ring"
        >
          {t('common.skipToContent')}
        </a>
        <UtilityBar site={site} />
        <SiteHeader site={site} />
        <main id="main" className="flex-1">
          {/* Only the error boundary's copy, so no page ships the whole catalog (ADR-013). */}
          <I18nProvider locale={locale} messages={errorMessages}>
            {children}
          </I18nProvider>
        </main>
        <SiteFooter site={site} />
        <WebVitalsReporter />
      </body>
    </html>
  );
}
