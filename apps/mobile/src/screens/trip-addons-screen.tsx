import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Loading, Notice } from '../components/states';
import { problemSlug } from '../lib/api';
import { tripStore } from '../lib/trips';
import { useApp, useT } from '../providers/app-provider';

type Addon = Schemas['AddonCard'];
type Linked =
  | { kind: 'ready'; link: Schemas['AddonLink']; addons: Addon[] }
  | { kind: 'failed'; status: number };

const QUOTE_ISSUES = new Set(['not_available_there', 'dates_invalid', 'too_many_travellers']);

/**
 * Extras for one trip (ADR-027): the API confirms the booking (session or guest token) with a
 * short-lived link token and the trip's dates and travellers, then the add-on is quoted for them
 * and checked out like any booking.
 */
export function TripAddonsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, currency } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['trip-addons', id, currency],
    // Link tokens expire after a couple of hours; never reuse one from an old cache entry.
    gcTime: 0,
    queryFn: async (): Promise<Linked> => {
      const { data, response } = await api.POST('/v1/addon-links', {
        params: { header: await tripStore.bookingHeaders(id) },
        body: { bookingId: id },
      });
      if (!data) return { kind: 'failed', status: response.status };
      const list = await api.GET('/v1/addons', {
        params: {
          query: {
            currency,
            ...(data.trip.countryCode ? { countryCode: data.trip.countryCode } : {}),
          },
        },
      });
      return { kind: 'ready', link: data, addons: list.data?.addons ?? [] };
    },
  });

  if (query.isPending) return <Loading label={t('addons.linking')} />;
  if (!query.data)
    return (
      <Notice
        body={t('mobile.networkError')}
        action={t('mobile.retry')}
        onAction={() => void query.refetch()}
      />
    );
  if (query.data.kind === 'failed')
    return (
      <Notice
        body={query.data.status === 409 ? t('addons.notLinkable') : t('addons.errors.generic')}
      />
    );
  const { link, addons } = query.data;
  const travellers =
    link.trip.travellers.adults + link.trip.travellers.children + link.trip.travellers.infants;

  const add = async (addon: Addon) => {
    setBusy(addon.id);
    setError(null);
    try {
      const {
        data,
        error: problem,
        response,
      } = await api.POST('/v1/inhouse-quotes', {
        body: {
          kind: 'addon',
          addonId: addon.id,
          startDate: link.trip.startDate,
          endDate: link.trip.endDate,
          travellers: link.trip.travellers,
          linkToken: link.linkToken,
          cityId: null,
          currency,
        },
      });
      if (data) {
        router.push(`/checkout/${data.quoteId}` as Href);
        return;
      }
      const code = (problem as { code?: string } | undefined)?.code;
      setError(
        code && QUOTE_ISSUES.has(code)
          ? t(`addons.errors.${code as 'dates_invalid'}`)
          : problemSlug(problem) === 'link-invalid'
            ? t('addons.linkExpired')
            : response.status === 404 || response.status === 410
              ? t('addons.errors.unavailable')
              : t('addons.errors.generic'),
      );
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      testID="trip-addons"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      <Text className="font-body-bold text-body text-foreground">
        {t('addons.forBooking', {
          reference: link.trip.reference,
          dates: format.dateRange(link.trip.startDate, link.trip.endDate, 'medium'),
          travellers: t('booking.inhouse.travellers', { count: travellers }),
        })}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      {addons.length === 0 ? (
        <Text className="font-body text-body text-foreground">{t('addons.none')}</Text>
      ) : (
        addons.map((addon) => (
          <Card key={addon.id} className="gap-2 p-4">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="font-body-bold text-caption text-muted">
                {t(`booking.inhouse.types.${addon.type}`)}
              </Text>
              {addon.sample ? <Badge variant="neutral">{t('inhouse.sample')}</Badge> : null}
            </View>
            <Text className="font-heading text-h4 text-heading">{addon.title}</Text>
            <Text className="font-body text-body-sm text-foreground">{addon.summary}</Text>
            <Text className="font-body-bold text-body text-heading">
              {t(`addons.unitPrice.${addon.pricingBasis}`, {
                price: format.money(addon.unitPrice),
              })}
            </Text>
            <Button
              testID={`addon-add-${addon.slug}`}
              variant="secondary"
              loading={busy === addon.id}
              disabled={busy !== null}
              onPress={() => void add(addon)}
            >
              {t('addons.add', { title: addon.title })}
            </Button>
          </Card>
        ))
      )}
    </ScrollView>
  );
}
