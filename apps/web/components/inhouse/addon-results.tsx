import { I18nProvider } from '@suskii/i18n/react';
import {
  addonsDraftToInput,
  createAddonsFormSchema,
  parseAddonsParams,
  type AddonsForm,
} from '@suskii/shared';

import { api } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import type { SearchParams } from '../../lib/search-initial';
import { AvailabilityNotice } from '../availability-notice';
import { Container } from '../layout/container';

import { AddonOffers, type AddonMode } from './addon-offers';
import { pickAddonOffersMessages } from './addon-offers-messages';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Standalone = Extract<AddonsForm, { mode: 'standalone' }>;

/**
 * What the add-ons page lists (ADR-027): the extras for a booking opened from its page (`?for=`),
 * for a booking found by reference (`?booking=`, last name kept in this tab only), for a
 * standalone trip from the form, or everything on sale.
 */
export async function AddonResults({ query }: { query: SearchParams }) {
  const { t, locale, messages, currency } = await getI18n();
  const forBooking = typeof query.for === 'string' && UUID.test(query.for) ? query.for : null;
  const draft = parseAddonsParams(query);
  const parsed = createAddonsFormSchema().safeParse(addonsDraftToInput(draft));
  const form = parsed.success ? parsed.data : null;

  let mode: AddonMode | null = null;
  if (forBooking) mode = { kind: 'booking', bookingId: forBooking };
  else if (form?.mode === 'booking') mode = { kind: 'reference', reference: form.bookingReference };
  else if (form?.mode === 'standalone') {
    const trip: Standalone = form;
    if (trip.type === 'extra_baggage') {
      return (
        <Container className="pt-8 pb-12">
          <p role="status" className="font-body text-body text-foreground">
            {t('addons.baggage')}
          </p>
        </Container>
      );
    }
    const list = await api.addons({ currency, type: trip.type, cityId: trip.cityId });
    mode = {
      kind: 'standalone',
      addons: list?.addons ?? [],
      request: {
        startDate: trip.startDate,
        endDate: trip.endDate,
        travellers: trip.travellers,
        cityId: trip.cityId,
      },
    };
  } else {
    const list = await api.addons({ currency });
    if (!list || list.addons.length === 0)
      return <AvailabilityNotice vertical="travel_addons" hasSearch={false} />;
    mode = { kind: 'browse', addons: list.addons };
  }

  return (
    <section aria-labelledby="addons-heading" className="pt-8 pb-12 md:pb-16">
      <Container className="flex flex-col gap-4">
        <h2 id="addons-heading" className="font-heading text-h3 font-bold text-heading">
          {t('addons.heading')}
        </h2>
        <I18nProvider locale={locale} messages={pickAddonOffersMessages(messages)}>
          <AddonOffers mode={mode} currency={currency} />
        </I18nProvider>
      </Container>
    </section>
  );
}
