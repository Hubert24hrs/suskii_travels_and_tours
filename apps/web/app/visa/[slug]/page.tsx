import { I18nProvider } from '@suskii/i18n/react';
import { parseVisaParams } from '@suskii/shared';
import { Badge, Card } from '@suskii/ui-web';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Breadcrumbs } from '../../../components/breadcrumbs';
import { BookVisa } from '../../../components/inhouse/book-visa';
import { pickBookVisaMessages } from '../../../components/inhouse/book-visa-messages';
import { Container } from '../../../components/layout/container';
import { api } from '../../../lib/api';
import { getI18n } from '../../../lib/i18n';
import { travellersFrom } from '../../../lib/inhouse-query';
import type { SearchParams } from '../../../lib/search-initial';
import { pageMetadata } from '../../../lib/seo';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { currency } = await getI18n();
  const { slug } = await params;
  const product = await api.visaProduct(slug, currency);
  if (!product) return {};
  return pageMetadata({
    title: product.title,
    description: product.summary,
    path: `/visa/${product.slug}`,
    noIndex: product.sample,
  });
}

/** A visa assistance product: the documents it needs, its fee and the booking form. */
export default async function VisaProductPage({ params, searchParams }: Props) {
  const { t, format, currency, locale, messages } = await getI18n();
  const { slug } = await params;
  const query = await searchParams;
  const [product, countries] = await Promise.all([
    api.visaProduct(slug, currency),
    api.countries(),
  ]);
  if (!product) notFound();

  // The checker's answers carry over (`?nationality=NG&purpose=tourism&date=...`).
  const { draft } = parseVisaParams(query);
  const purpose = product.purposes.includes(draft.purpose)
    ? draft.purpose
    : (product.purposes[0] ?? 'tourism');
  const collator = new Intl.Collator(locale);
  const countryOptions = [
    { value: '', label: t('checkout.fields.choose') },
    ...(countries?.items ?? [])
      .filter((country) => country.code !== product.destination)
      .map(({ code, name }) => ({ value: code, label: name }))
      .sort((a, b) => collator.compare(a.label, b.label)),
  ];

  return (
    <Container className="flex flex-col gap-6 pt-6 pb-16">
      <Breadcrumbs
        items={[
          { name: t('verticals.visa'), path: '/visa' },
          { name: product.title, path: `/visa/${product.slug}` },
        ]}
      />
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-3 lg:items-start">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-body text-body-sm font-bold text-muted">
                {format.country(product.destination)}
              </p>
              {product.sample ? <Badge variant="neutral">{t('inhouse.sample')}</Badge> : null}
            </div>
            <h1 className="font-heading text-hero-mobile font-extrabold text-heading md:text-hero">
              {product.title}
            </h1>
            <p className="font-body text-body text-foreground">{product.summary}</p>
            <p className="font-body text-body-sm text-foreground">
              {t('visa.products.processing', {
                min: product.processingDaysMin,
                max: product.processingDaysMax,
              })}
              {' · '}
              {t('visa.detail.purposes', {
                purposes: format.list(
                  product.purposes.map((item) => t(`search.visa.purposes.${item}`)),
                ),
              })}
            </p>
            <p className="font-body text-body font-bold text-heading">
              {t('visa.products.price', { price: format.money(product.price) })}
            </p>
            {product.governmentFeeNote ? (
              <p className="font-body text-body-sm text-foreground">{product.governmentFeeNote}</p>
            ) : null}
            {product.sample ? (
              <p className="font-body text-body-sm text-foreground">{t('inhouse.sampleNote')}</p>
            ) : null}
          </header>
          <Card asChild className="flex flex-col gap-3 p-4">
            <section aria-labelledby="visa-checklist">
              <h2 id="visa-checklist" className="font-heading text-h3 font-bold text-heading">
                {t('visa.detail.checklist')}
              </h2>
              <ul className="flex flex-col gap-3">
                {product.checklist.map((item) => (
                  <li key={item.key} className="flex flex-col gap-1">
                    <p className="flex flex-wrap items-center gap-2 font-body text-body font-bold text-foreground">
                      {item.label}
                      <Badge variant={item.required ? 'info' : 'neutral'}>
                        {item.required ? t('visa.detail.required') : t('visa.detail.optional')}
                      </Badge>
                    </p>
                    {item.description ? (
                      <p className="font-body text-body-sm text-foreground">{item.description}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="font-body text-body-sm text-foreground">
                {t('visa.detail.afterBooking')}
              </p>
            </section>
          </Card>
          <p className="font-body text-body-sm text-foreground">{product.disclaimer}</p>
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-4">
          <I18nProvider locale={locale} messages={pickBookVisaMessages(messages)}>
            <BookVisa
              productId={product.id}
              currency={currency}
              purposes={product.purposes.map((item) => ({
                value: item,
                label: t(`search.visa.purposes.${item}`),
              }))}
              countries={countryOptions}
              initial={{
                // From the checker, else the locale's region (en-NG: Nigeria) as a starting point.
                nationality:
                  [draft.nationality, locale.split('-')[1] ?? ''].find(
                    (code) => code && code !== product.destination,
                  ) ?? '',
                purpose,
                travelDate: draft.travelDate,
                travellers: travellersFrom(query),
              }}
            />
          </I18nProvider>
        </aside>
      </div>
    </Container>
  );
}
