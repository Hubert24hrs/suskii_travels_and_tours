import { BRAND } from '@suskii/shared';
import { buttonVariants } from '@suskii/ui-web';
import { Smartphone } from 'lucide-react';
import { renderSVG } from 'uqr';

import type { SiteContent } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { Container } from '../layout/container';

/**
 * App download block. Store badges link only when the apps are live (store URLs in the CMS,
 * restricted to the official stores by the API); the QR code is rendered on the server.
 */
export async function AppDownload({ apps }: { apps: SiteContent['apps'] | undefined }) {
  const { t } = await getI18n();
  const stores = [
    apps?.iosUrl ? { href: apps.iosUrl, label: t('sections.app.appStore') } : null,
    apps?.androidUrl ? { href: apps.androidUrl, label: t('sections.app.googlePlay') } : null,
  ].filter((store): store is { href: string; label: string } => store !== null);
  const qrTarget = stores[0]?.href;
  return (
    <section aria-labelledby="app-heading" className="bg-primary-subtle py-10 md:py-16">
      <Container className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-surface text-primary">
            <Smartphone aria-hidden="true" className="size-6" />
          </span>
          <div className="flex flex-col gap-2">
            <h2 id="app-heading" className="font-heading text-h2 font-extrabold text-heading">
              {t('sections.app.heading', { brand: BRAND.shortName })}
            </h2>
            <p className="font-body text-body text-foreground">{t('sections.app.body')}</p>
            {stores.length === 0 ? (
              <p className="font-body text-body font-bold text-foreground">
                {t('sections.app.comingSoon')}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {stores.map((store) => (
                  <li key={store.href}>
                    <a
                      href={store.href}
                      rel="noopener noreferrer"
                      target="_blank"
                      className={buttonVariants({ variant: 'primary' })}
                    >
                      {store.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {qrTarget ? (
          <figure className="hidden flex-col items-center gap-2 lg:flex">
            <span
              className="block size-20 rounded-lg bg-surface p-2 [&>svg]:size-full"
              dangerouslySetInnerHTML={{ __html: renderSVG(qrTarget, { border: 1 }) }}
            />
            <figcaption className="font-body text-caption text-foreground">
              {t('sections.app.qrLabel')}
            </figcaption>
          </figure>
        ) : null}
      </Container>
    </section>
  );
}
