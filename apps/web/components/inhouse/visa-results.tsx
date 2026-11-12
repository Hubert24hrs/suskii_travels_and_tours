import { parseVisaParams } from '@suskii/shared';
import { Badge, Card } from '@suskii/ui-web';

import { api } from '../../lib/api';
import type { Schemas } from '../../lib/browser-api';
import { getI18n } from '../../lib/i18n';
import type { SearchParams } from '../../lib/search-initial';
import { AppLink } from '../app-link';
import { AvailabilityNotice } from '../availability-notice';
import { Container } from '../layout/container';

type Product = Schemas['VisaProductCard'];
type Eligibility = Schemas['VisaEligibility'];

const REQUIREMENT_VARIANT = {
  visa_free: 'success',
  visa_on_arrival: 'info',
  e_visa: 'info',
  visa_required: 'warning',
  not_available: 'danger',
  unknown: 'neutral',
} as const;

/** Visa assistance products; each links to its page with the traveller's answers carried over. */
export async function VisaProductCards({
  products,
  query = '',
}: {
  products: readonly Product[];
  query?: string;
}) {
  const { t, format } = await getI18n();
  return (
    <ul className="grid gap-4 md:grid-cols-2" data-testid="visa-products">
      {products.map((product) => (
        <li key={product.id}>
          <Card interactive className="relative flex h-full flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-body text-caption font-bold text-muted">
                {format.country(product.destination)}
              </p>
              {product.sample ? <Badge variant="neutral">{t('inhouse.sample')}</Badge> : null}
            </div>
            <h3 className="font-heading text-h4 font-bold text-heading">
              <AppLink
                href={`/visa/${product.slug}${query}`}
                className="after:absolute after:inset-0 focus-visible:focus-ring"
              >
                {product.title}
              </AppLink>
            </h3>
            <p className="font-body text-body-sm text-foreground">{product.summary}</p>
            <p className="font-body text-caption text-muted">
              {t('visa.products.processing', {
                min: product.processingDaysMin,
                max: product.processingDaysMax,
              })}
            </p>
            <p className="mt-auto font-body text-body font-bold text-heading">
              {t('visa.products.price', { price: format.money(product.price) })}
            </p>
            {product.governmentFeeNote ? (
              <p className="font-body text-caption text-foreground">{product.governmentFeeNote}</p>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}

async function EligibilityCard({ result }: { result: Eligibility }) {
  const { t, format } = await getI18n();
  return (
    <Card className="flex flex-col gap-3 p-6" data-testid="visa-eligibility">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-h3 font-bold text-heading">{t('visa.result.heading')}</h2>
        {result.sample ? <Badge variant="neutral">{t('inhouse.sample')}</Badge> : null}
      </div>
      <Badge variant={REQUIREMENT_VARIANT[result.requirement]} className="self-start">
        {t(`visa.result.requirements.${result.requirement}`)}
      </Badge>
      {result.requirement === 'unknown' ? (
        <p className="font-body text-body text-foreground">{t('visa.result.unknownBody')}</p>
      ) : null}
      {result.maxStayDays ? (
        <p className="font-body text-body text-foreground">
          {t('visa.result.maxStay', { days: result.maxStayDays })}
        </p>
      ) : null}
      {result.notes ? <p className="font-body text-body text-foreground">{result.notes}</p> : null}
      {result.verifiedAt ? (
        <p className="font-body text-body-sm text-muted">
          {t('visa.result.verified', { date: format.date(result.verifiedAt, 'long') })}
        </p>
      ) : null}
      {result.sample ? (
        <p className="font-body text-body-sm text-foreground">{t('visa.result.sample')}</p>
      ) : null}
      <p className="font-body text-caption text-foreground">{result.disclaimer}</p>
    </Card>
  );
}

/**
 * The eligibility answer for the checker's inputs (never a guess: `unknown` without a rule) and
 * the assistance on offer; without a valid search, every product on sale.
 */
export async function VisaResults({ query }: { query: SearchParams }) {
  const { t, currency } = await getI18n();
  const { form } = parseVisaParams(query);
  if (form) {
    const result = await api.visaEligibility({
      nationality: form.nationality,
      destination: form.destination,
      purpose: form.purpose,
      currency,
    });
    const carry = `?${new URLSearchParams({
      nationality: form.nationality,
      purpose: form.purpose,
      date: form.travelDate,
    }).toString()}`;
    return (
      <section aria-label={t('visa.result.heading')} className="pt-8 pb-12 md:pb-16">
        <Container className="flex flex-col gap-6">
          {result ? <EligibilityCard result={result} /> : null}
          {result && result.products.length > 0 ? (
            <div className="flex flex-col gap-4">
              <h2 className="font-heading text-h3 font-bold text-heading">
                {t('visa.products.forTrip')}
              </h2>
              <VisaProductCards products={result.products} query={carry} />
            </div>
          ) : result && result.requirement !== 'visa_free' ? (
            <p className="font-body text-body text-foreground">{t('visa.products.none')}</p>
          ) : null}
        </Container>
      </section>
    );
  }
  const list = await api.visaProducts({ currency });
  const products = list?.products ?? [];
  if (products.length === 0) return <AvailabilityNotice vertical="visa" hasSearch={false} />;
  return (
    <section aria-labelledby="visa-products-heading" className="pt-8 pb-12 md:pb-16">
      <Container className="flex flex-col gap-4">
        <h2 id="visa-products-heading" className="font-heading text-h3 font-bold text-heading">
          {t('visa.products.heading')}
        </h2>
        <VisaProductCards products={products} />
      </Container>
    </section>
  );
}
