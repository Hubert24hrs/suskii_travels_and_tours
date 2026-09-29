import { ChevronDown } from 'lucide-react';

import type { HomeContent } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { AppLink } from '../app-link';
import { Container } from '../layout/container';

interface RouteLink {
  slug: string;
  origin: { cityName: string };
  destination: { cityName: string };
}

/** FAQ (collapsible, no JavaScript) and internal links to the programmatic SEO pages. */
export async function SeoContent({
  faqs,
  routes,
  destinations,
}: {
  faqs: HomeContent['faqs'];
  routes: RouteLink[];
  destinations: { slug: string; city: { name: string } }[];
}) {
  const { t } = await getI18n();
  const linkClass =
    'inline-flex min-h-12 items-center font-body text-body-sm text-foreground hover:text-primary hover:underline focus-visible:focus-ring';
  return (
    <section aria-labelledby="faq-heading" className="py-10 md:py-16">
      <Container className="grid gap-10 lg:grid-cols-2">
        {faqs.length > 0 ? (
          <div className="flex flex-col gap-4">
            <h2 id="faq-heading" className="font-heading text-h2 font-extrabold text-heading">
              {t('sections.faq.heading')}
            </h2>
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
              {faqs.map((faq) => (
                <details key={faq.id} className="group px-4">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 font-body text-body font-bold text-foreground focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
                    {faq.question}
                    <ChevronDown
                      aria-hidden="true"
                      className="size-5 shrink-0 text-muted transition-transform duration-base group-open:rotate-180"
                    />
                  </summary>
                  <p className="pb-4 font-body text-body-sm text-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        ) : (
          <h2 id="faq-heading" className="sr-only">
            {t('sections.popular.routesHeading')}
          </h2>
        )}
        <div className="flex flex-col gap-8">
          {routes.length > 0 ? (
            <nav aria-labelledby="popular-routes-heading" className="flex flex-col gap-2">
              <h3
                id="popular-routes-heading"
                className="font-heading text-h4 font-bold text-heading"
              >
                {t('sections.popular.routesHeading')}
              </h3>
              <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {routes.map((route) => (
                  <li key={route.slug}>
                    <AppLink href={`/flights/${route.slug}`} className={linkClass}>
                      {t('sections.popular.route', {
                        origin: route.origin.cityName,
                        destination: route.destination.cityName,
                      })}
                    </AppLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          {destinations.length > 0 ? (
            <nav aria-labelledby="popular-destinations-heading" className="flex flex-col gap-2">
              <h3
                id="popular-destinations-heading"
                className="font-heading text-h4 font-bold text-heading"
              >
                {t('sections.popular.destinationsHeading')}
              </h3>
              <ul className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
                {destinations.map((destination) => (
                  <li key={destination.slug}>
                    <AppLink href={`/hotels/${destination.slug}`} className={linkClass}>
                      {t('sections.popular.hotels', { city: destination.city.name })}
                    </AppLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      </Container>
    </section>
  );
}
