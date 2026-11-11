'use client';

import type { Messages } from '@suskii/i18n';
import { useFormatters, useTranslator } from '@suskii/i18n/react';
import { useEffect, useState } from 'react';

import {
  clearRecentHotelSearches,
  lastMinuteHref,
  localToday,
  recentHotelSearches,
  recentHotelSearchHref,
  tonightIn,
  type RecentHotelSearch,
} from '../../lib/recent-hotel-searches';
import { AppLink } from '../app-link';
import { Container } from '../layout/container';

/** The catalog subset this section needs; the page passes it through its I18nProvider. */
export type RecentSearchMessages = Pick<Messages['results'], 'discover'>;

/**
 * "Continue your search" on the hotels page (ADR-097): the visitor's last hotel searches, read
 * from this browser's storage after the page has loaded, so the server render and other
 * visitors never see them. Nothing renders when there are none.
 */
export function RecentHotelSearches() {
  const { t } = useTranslator<RecentSearchMessages>();
  const format = useFormatters();
  const [searches, setSearches] = useState<RecentHotelSearch[]>([]);

  useEffect(() => {
    // Storage exists only in the browser: read once the page is there.
    const timer = setTimeout(() => setSearches(recentHotelSearches(localToday())), 0);
    return () => clearTimeout(timer);
  }, []);

  if (searches.length === 0) return null;
  return (
    <Container className="py-6">
      <section
        aria-labelledby="recent-hotel-searches"
        className="flex flex-col gap-3"
        data-testid="recent-hotel-searches"
      >
        <h2 id="recent-hotel-searches" className="font-heading text-h3 font-bold text-heading">
          {t('discover.recentHeading')}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {searches.map((search) => (
            <li key={`${search.cityId}-${search.checkIn}-${search.checkOut}`}>
              <AppLink
                href={recentHotelSearchHref(search)}
                className="inline-flex min-h-12 items-center rounded-pill border border-border-strong bg-surface px-4 font-body text-body-sm font-bold text-foreground focus-visible:focus-ring"
                data-testid="recent-hotel-search"
              >
                {t('discover.recentItem', {
                  city: search.cityName,
                  dates: format.dateRange(search.checkIn, search.checkOut),
                  guests: t('discover.recentGuests', {
                    count: search.rooms.reduce(
                      (sum, room) => sum + room.adults + room.childAges.length,
                      0,
                    ),
                  }),
                })}
              </AppLink>
            </li>
          ))}
        </ul>
        <p className="flex flex-wrap items-center gap-x-3 font-body text-caption text-foreground">
          {t('discover.recentNote')}
          <button
            type="button"
            onClick={() => {
              clearRecentHotelSearches();
              setSearches([]);
            }}
            className="inline-flex min-h-6 items-center font-bold text-primary underline focus-visible:focus-ring"
            data-testid="recent-hotel-clear"
          >
            {t('discover.recentClear')}
          </button>
        </p>
      </section>
    </Container>
  );
}

/** A popular city and the time zone its nights are dated in (null: read in UTC, as the API does). */
export interface LastMinuteCity {
  id: string;
  name: string;
  timeZone: string | null;
}

/**
 * "Last-minute deals" under the popular destinations (ADR-097): tonight's "Deals" collection in
 * each of them. "Tonight" is the night that begins on the city's own date at the moment the
 * browser's clock shows, never the visitor's date: late in the visitor's evening a city to the
 * east is already in tomorrow, and the API refuses a check-in on its yesterday. The links
 * render once the page runs in the browser and are dated again when the visitor comes back to
 * the tab, so a page left open overnight does not offer last night. The section sits low on
 * the page, where its arrival moves nothing a visitor reads.
 */
export function LastMinuteDeals({ cities }: { cities: readonly LastMinuteCity[] }) {
  const { t } = useTranslator<RecentSearchMessages>();
  const [readAt, setReadAt] = useState<number | null>(null);

  useEffect(() => {
    const read = (): void => setReadAt(Date.now());
    const timer = setTimeout(read, 0);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (readAt === null || cities.length === 0) return null;
  const now = new Date(readAt);
  return (
    <Container className="py-6">
      <section
        aria-labelledby="last-minute-deals"
        className="flex flex-col gap-3"
        data-testid="last-minute-deals"
      >
        <h2 id="last-minute-deals" className="font-heading text-h3 font-bold text-heading">
          {t('discover.lastMinuteHeading')}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {cities.map((city) => (
            <li key={city.id}>
              <AppLink
                href={lastMinuteHref(city.id, tonightIn(city.timeZone, now))}
                className="inline-flex min-h-12 items-center rounded-pill border border-border-strong bg-surface px-4 font-body text-body-sm font-bold text-foreground focus-visible:focus-ring"
                data-testid="last-minute-deal"
              >
                {t('discover.lastMinuteItem', { city: city.name })}
              </AppLink>
            </li>
          ))}
        </ul>
        <p className="font-body text-caption text-foreground">{t('discover.lastMinuteNote')}</p>
      </section>
    </Container>
  );
}
