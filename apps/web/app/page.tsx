import { AppDownload } from '../components/home/app-download';
import { FlexiblePayment } from '../components/home/flexible-payment';
import { FreshFlightOffers } from '../components/home/fresh-flight-offers';
import { Hero } from '../components/home/hero';
import { NewsletterSection } from '../components/home/newsletter-section';
import { PackagesTeaser } from '../components/home/packages-teaser';
import { PrimePromo } from '../components/home/prime-promo';
import { SeoContent } from '../components/home/seo-content';
import { TopHotelDestinations } from '../components/home/top-hotel-destinations';
import { TrustStrip } from '../components/home/trust-strip';
import { WhyBook } from '../components/home/why-book';
import { JsonLd } from '../components/json-ld';
import { SearchPanel } from '../components/search/search-panel';
import { api } from '../lib/api';
import { getI18n } from '../lib/i18n';
import { faqJsonLd, organizationJsonLd, websiteJsonLd } from '../lib/seo';

export const metadata = { alternates: { canonical: '/' } };

/** Homepage: every section of PROJECT_SPEC.json#/homepage_spec.sections_in_order, in order. */
export default async function HomePage() {
  const { locale, currency } = await getI18n();
  const [site, home, deals, destinations, routes] = await Promise.all([
    api.site(locale),
    api.home(locale),
    api.deals(currency),
    api.hotelDestinations(currency),
    api.dealRoutes(),
  ]);
  const hotelDestinations = destinations?.destinations ?? [];
  return (
    <>
      <JsonLd
        data={[
          organizationJsonLd(),
          websiteJsonLd(),
          ...(home && home.faqs.length > 0 ? [faqJsonLd(home.faqs)] : []),
        ]}
      />
      <Hero hero={home?.hero} trustSignals={site?.trustSignals ?? []} />
      <SearchPanel destinations={hotelDestinations} />
      <div className="mt-10">
        <TrustStrip site={site} />
      </div>
      <FreshFlightOffers deals={deals?.deals ?? []} origins={deals?.origins ?? []} />
      <TopHotelDestinations destinations={hotelDestinations} />
      <PrimePromo prime={home?.prime} />
      <FlexiblePayment />
      <PackagesTeaser />
      <WhyBook whyBook={home?.whyBook} />
      <AppDownload apps={site?.apps} />
      <NewsletterSection site={site} />
      <SeoContent
        faqs={home?.faqs ?? []}
        routes={routes?.routes ?? []}
        destinations={hotelDestinations}
      />
    </>
  );
}
