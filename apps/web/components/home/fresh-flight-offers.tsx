import { DealCard } from '@suskii/ui-web';

import type { FlightDeal } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { dealSearchHref } from '../../lib/search-links';
import { AppLink } from '../app-link';
import { RouteArt } from '../art/route-art';

import { DealsFilter } from './deals-filter';
import { Section } from './section';

/** Deal cards for a list of deals, labelled per the pricing guardrails. */
export async function DealCards({ deals }: { deals: FlightDeal[] }) {
  const { t, format } = await getI18n();
  const now = new Date();
  return deals.map((deal) => ({
    key: deal.id,
    origin: deal.origin.code,
    card: (
      <DealCard
        className="w-full"
        href={dealSearchHref(deal)}
        linkComponent={AppLink}
        media={<RouteArt origin={deal.origin.code} destination={deal.destination.code} />}
        originCode={deal.origin.code}
        destinationCode={deal.destination.code}
        routeLabel={t('sections.deals.route', {
          origin: deal.origin.cityName,
          destination: deal.destination.cityName,
        })}
        airlineName={deal.carrier.name}
        dates={
          deal.returnDate
            ? format.dateRange(deal.departureDate, deal.returnDate)
            : format.date(deal.departureDate, 'short')
        }
        cabin={t(`cabins.${deal.cabinClass}`)}
        priceLabel={t('common.fromPrice', { price: format.moneyFrom(deal.price) })}
        statusLabel={deal.sample ? t('common.sampleFare') : undefined}
        updatedLabel={t('common.updated', { time: format.relativeTime(deal.updatedAt, now) })}
        ctaLabel={t('sections.deals.cta')}
      />
    ),
  }));
}

export async function FreshFlightOffers({
  deals,
  origins,
}: {
  deals: FlightDeal[];
  origins: { code: string; cityName: string }[];
}) {
  const { t } = await getI18n();
  const items = await DealCards({ deals });
  return (
    <Section
      id="deals"
      title={t('sections.deals.heading')}
      action={{ href: '/deals', label: t('sections.deals.seeAll') }}
    >
      {items.length > 0 ? (
        <>
          <DealsFilter
            label={t('sections.deals.filterLabel')}
            allLabel={t('sections.deals.allOrigins')}
            origins={origins}
            items={items}
            limit={8}
          />
          <p className="font-body text-caption text-muted">{t('sections.deals.roundTripNote')}</p>
        </>
      ) : (
        <p className="font-body text-body text-muted">
          {t('sections.deals.empty')}{' '}
          <AppLink href="/flights" className="font-bold text-primary underline">
            {t('search.flights.submit')}
          </AppLink>
        </p>
      )}
    </Section>
  );
}
