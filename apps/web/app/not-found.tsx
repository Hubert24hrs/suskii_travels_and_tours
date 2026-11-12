import { buttonVariants } from '@suskii/ui-web';
import type { Metadata } from 'next';

import { AppLink } from '../components/app-link';
import { Container } from '../components/layout/container';
import { NAV_ITEMS } from '../components/layout/nav-items';
import { getI18n } from '../lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('pages.notFound.title'), robots: { index: false } };
}

/** Helpful 404: also covers links to features later phases build (sign in, manage booking, Prime). */
export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <Container className="py-16">
      <div className="flex max-w-dialog flex-col items-start gap-6">
        <h1 className="font-heading text-h2 font-extrabold text-heading">
          {t('pages.notFound.heading')}
        </h1>
        <p className="font-body text-body text-foreground">{t('pages.notFound.body')}</p>
        <ul className="flex flex-wrap gap-2">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <AppLink href={item.href} className={buttonVariants({ variant: 'ghost' })}>
                {t(`verticals.${item.vertical}`)}
              </AppLink>
            </li>
          ))}
        </ul>
        <AppLink href="/" className={buttonVariants({ variant: 'primary', fullWidth: 'mobile' })}>
          {t('pages.notFound.home')}
        </AppLink>
      </div>
    </Container>
  );
}
