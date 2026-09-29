import { BRAND, SUPPORTED_LOCALES } from '@suskii/shared';

import { setLocale } from '../../app/actions';
import type { SiteContent } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { AppLink } from '../app-link';

import { Container } from './container';
import { NAV_ITEMS } from './nav-items';
import { PreferenceSelect } from './preference-select';

const SOCIAL_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
};

const linkClass =
  'inline-flex min-h-12 items-center font-body text-body-sm text-foreground hover:text-primary focus-visible:focus-ring';

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-heading text-body font-bold text-heading">{title}</h2>
      <ul className="flex flex-col">{children}</ul>
    </div>
  );
}

/**
 * Footer. Company, support and legal links come from published CMS pages only, so nothing links
 * to a policy that does not exist yet; social links appear once the business provides them.
 */
export async function SiteFooter({ site }: { site: SiteContent | null }) {
  const { t, locale } = await getI18n();
  const pages = (group: string) => site?.pages.filter((page) => page.group === group) ?? [];
  const pageLinks = (group: string) =>
    pages(group).map((page) => (
      <li key={page.slug}>
        <AppLink href={`/info/${page.slug}`} className={linkClass}>
          {page.title}
        </AppLink>
      </li>
    ));
  const email = site?.contact.email;

  return (
    <footer className="mt-16 border-t border-border bg-surface">
      <Container className="grid grid-cols-2 gap-8 py-12 md:grid-cols-4 lg:grid-cols-5">
        <Column title={t('footer.explore')}>
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <AppLink href={item.href} className={linkClass}>
                {t(`verticals.${item.vertical}`)}
              </AppLink>
            </li>
          ))}
          <li>
            <AppLink href="/deals" className={linkClass}>
              {t('footer.deals')}
            </AppLink>
          </li>
        </Column>
        <Column title={t('footer.support')}>
          <li>
            <AppLink href="/manage-booking" className={linkClass}>
              {t('footer.manageBooking')}
            </AppLink>
          </li>
          {email ? (
            <li>
              <a href={`mailto:${email}`} className={linkClass}>
                {t('footer.emailUs', { email })}
              </a>
            </li>
          ) : null}
          {pageLinks('support')}
        </Column>
        {pages('company').length > 0 ? (
          <Column title={t('footer.company')}>{pageLinks('company')}</Column>
        ) : null}
        {pages('legal').length > 0 ? (
          <Column title={t('footer.legal')}>{pageLinks('legal')}</Column>
        ) : null}
        {site && site.social.length > 0 ? (
          <Column title={t('footer.follow')}>
            {site.social.map((link) => (
              <li key={link.url}>
                <a href={link.url} className={linkClass} rel="noopener noreferrer" target="_blank">
                  {SOCIAL_LABELS[link.network] ?? link.network}
                </a>
              </li>
            ))}
          </Column>
        ) : null}
        <div className="col-span-2 flex flex-col gap-2 md:col-span-1">
          <h2 className="font-heading text-body font-bold text-heading">
            {t('footer.preferences')}
          </h2>
          <PreferenceSelect
            action={setLocale}
            name="locale"
            label={t('footer.language')}
            value={locale}
            submitLabel={t('footer.save')}
            options={SUPPORTED_LOCALES.map((code) => ({
              value: code,
              label: t(`footer.locales.${code}`),
            }))}
          />
        </div>
      </Container>
      <div className="border-t border-border">
        <Container className="py-6 font-body text-caption text-muted">
          {t('footer.copyright', { year: String(new Date().getUTCFullYear()), name: BRAND.name })}
        </Container>
      </div>
    </footer>
  );
}
