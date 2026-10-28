import { color } from '@suskii/design-tokens';
import { I18nProvider } from '@suskii/i18n/react';
import { BRAND, localeDirection } from '@suskii/shared';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { preconnect } from 'react-dom';

import { ErrorReporting } from '../components/error-reporting';
import { SiteFooter } from '../components/layout/site-footer';
import { SiteHeader, UtilityBar } from '../components/layout/site-header';
import { Marketing } from '../components/marketing/marketing';
import { StatusBanner } from '../components/status/status-banner';
import { WebVitalsReporter } from '../components/web-vitals-reporter';
import { adTagConfig, adTagsOn } from '../lib/ad-tags';
import { api } from '../lib/api';
import { publicEnv } from '../lib/env';
import { getI18n, type ErrorMessages } from '../lib/i18n';
import { getMarketingState } from '../lib/marketing-state';

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
  // Searches, sign-in and checkout call the API from the browser: open the connection (DNS, TCP
  // and TLS, three round trips on a slow network) while the page loads (ADR-075). Credentialed
  // CORS requests use their own connection pool, hence `use-credentials`.
  preconnect(new URL(publicEnv.apiBaseUrl).origin, { crossOrigin: 'use-credentials' });
  const site = await api.site(locale);
  const errorMessages: ErrorMessages = { pages: { error: messages.pages.error } };
  const adTags = adTagConfig();
  return (
    <html
      lang={locale}
      dir={localeDirection(locale)}
      className={`${headingFont.variable} ${bodyFont.variable}`}
    >
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 bg-surface px-4 py-3 font-body font-bold text-primary focus:not-sr-only focus:fixed focus:top-2 focus:inset-s-2 focus-visible:focus-ring"
        >
          {t('common.skipToContent')}
        </a>
        <StatusBanner />
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
        <ErrorReporting />
        {adTagsOn(adTags) ? (
          <Marketing
            config={adTags}
            labels={messages.cookies}
            initial={await getMarketingState()}
          />
        ) : null}
      </body>
    </html>
  );
}
