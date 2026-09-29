import { BRAND, SUPPORTED_CURRENCIES } from '@suskii/shared';
import { buttonVariants, cn } from '@suskii/ui-web';
import { MessageCircle, Phone } from 'lucide-react';

import { setCurrency } from '../../app/actions';
import type { SiteContent } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { AppLink } from '../app-link';

import { Container } from './container';
import { MobileMenu } from './mobile-menu';
import { NAV_ITEMS, whatsappHref } from './nav-items';
import { PreferenceSelect } from './preference-select';
import { StickyHeader } from './sticky-header';

const currencySymbol = (currency: string, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
    .formatToParts(0)
    .find((part) => part.type === 'currency')?.value ?? currency;

async function CurrencySelect({ className }: { className?: string }) {
  const { t, locale, currency } = await getI18n();
  return (
    <PreferenceSelect
      action={setCurrency}
      name="currency"
      label={t('header.currency')}
      value={currency}
      submitLabel={t('footer.save')}
      className={className}
      options={SUPPORTED_CURRENCIES.map((code) => ({
        value: code,
        label: `${code} ${currencySymbol(code, locale)}`,
      }))}
    />
  );
}

async function SupportLinks({ site, className }: { site: SiteContent | null; className?: string }) {
  const { t } = await getI18n();
  const phone = site?.contact.phone;
  const whatsapp = site?.contact.whatsapp;
  if (!phone && !whatsapp) return null;
  const link =
    'inline-flex min-h-12 items-center gap-2 font-body text-body-sm font-medium text-foreground hover:text-primary focus-visible:focus-ring';
  return (
    <div className={cn('flex items-center gap-4', className)}>
      {phone ? (
        <a href={`tel:${phone}`} className={link} aria-label={t('header.callSupport', { phone })}>
          <Phone aria-hidden="true" className="size-4" />
          {phone}
        </a>
      ) : null}
      {whatsapp ? (
        <a
          href={whatsappHref(whatsapp)}
          className={link}
          rel="noopener noreferrer"
          target="_blank"
          aria-label={t('header.whatsappSupport')}
        >
          <MessageCircle aria-hidden="true" className="size-4" />
          {t('header.whatsapp')}
        </a>
      ) : null}
    </div>
  );
}

/** Utility row above the sticky bar (desktop): support contacts, manage booking, currency. */
export async function UtilityBar({ site }: { site: SiteContent | null }) {
  const { t } = await getI18n();
  return (
    <div className="hidden border-b border-border bg-background lg:block">
      <Container className="flex min-h-12 items-center justify-end gap-6">
        <SupportLinks site={site} />
        <AppLink
          href="/manage-booking"
          className="inline-flex min-h-12 items-center font-body text-body-sm font-medium text-foreground hover:text-primary focus-visible:focus-ring"
        >
          {t('header.manageBooking')}
        </AppLink>
        <CurrencySelect />
      </Container>
    </div>
  );
}

/** Sticky header: wordmark (text until brand assets exist), primary nav, sign in, mobile drawer. */
export async function SiteHeader({ site }: { site: SiteContent | null }) {
  const { t } = await getI18n();
  const links = NAV_ITEMS.map((item) => ({
    href: item.href,
    label: t(`verticals.${item.vertical}`),
  }));
  return (
    <StickyHeader>
      <Container className="flex h-16 items-center gap-2 lg:gap-8">
        <MobileMenu
          labels={{
            open: t('header.openMenu'),
            title: t('header.menuTitle'),
            close: t('common.close'),
          }}
          links={[...links, { href: '/manage-booking', label: t('header.manageBooking') }]}
          footer={
            <div className="flex flex-col gap-4">
              <CurrencySelect />
              <SupportLinks site={site} />
            </div>
          }
        />
        <AppLink
          href="/"
          prefetch
          aria-label={t('header.homeLink', { brand: BRAND.shortName })}
          className="font-heading text-h4 font-extrabold whitespace-nowrap text-primary focus-visible:focus-ring"
        >
          {BRAND.shortName}
        </AppLink>
        <nav aria-label={t('header.primaryNav')} className="hidden lg:block">
          <ul className="flex items-center gap-6">
            {links.map((link) => (
              <li key={link.href}>
                <AppLink
                  href={link.href}
                  className="inline-flex min-h-12 items-center font-body text-body-sm font-bold text-foreground hover:text-primary focus-visible:focus-ring"
                >
                  {link.label}
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
        <AppLink
          href="/sign-in"
          className={cn(buttonVariants({ variant: 'ghost' }), 'ml-auto px-4')}
        >
          {t('header.signIn')}
        </AppLink>
      </Container>
    </StickyHeader>
  );
}
