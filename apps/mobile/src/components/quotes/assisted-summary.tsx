import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Text } from 'react-native';

import { useT } from '../../providers/app-provider';

/**
 * A price a person verified (ADR-104), in the checkout summary and on the trip screen: what it
 * is, when and where, the supplier's terms as staff wrote them, and that a person confirmed
 * the price. The terms are plain text and are shown as text.
 */
export function AssistedSummary({ item }: { item: NonNullable<Schemas['Quote']['assisted']> }) {
  const { t } = useT();
  const format = useFormatters();
  return (
    <>
      <Text className="font-body-bold text-body text-foreground">{item.product.title}</Text>
      <Text className="font-body text-body-sm text-foreground">
        {item.cityName ? `${item.cityName} · ` : ''}
        {format.dateRange(item.startDate, item.endDate, 'medium')}
      </Text>
      <Text className="font-body text-body-sm text-foreground">{item.summary}</Text>
      <Text className="font-body text-body-sm text-foreground">
        {item.refundable ? t('quotes.offer.refundable') : t('quotes.offer.nonRefundable')}
      </Text>
      <Text className="font-body text-body-sm text-muted">{t('quotes.offer.verified')}</Text>
    </>
  );
}
