import type { Schemas } from '@suskii/api-client';
import { Button } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { useApp, useT } from '../../providers/app-provider';

type Nearby = Schemas['NearbyAirports']['items'];

/**
 * Other airports near each end of a one-way or return search (`nearby-{from|to}-{code}`);
 * pressing one runs the same search from or to that airport. Nothing renders when neither end
 * has one, or while the API cannot say.
 */
export function NearbyAirports({
  origin,
  destination,
  onChoose,
}: {
  origin: string;
  destination: string;
  onChoose: (change: { from: string } | { to: string }) => void;
}) {
  const { api } = useApp();
  const { t } = useT();
  const nearby = useQuery({
    queryKey: ['nearby-airports', origin, destination],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const near = async (iataCode: string): Promise<Nearby> => {
        try {
          const { data } = await api.GET('/v1/catalog/airports/{iataCode}/nearby', {
            params: { path: { iataCode }, query: { limit: 3 } },
          });
          return data?.items ?? [];
        } catch {
          return [];
        }
      };
      const [from, to] = await Promise.all([near(origin), near(destination)]);
      return {
        // Never a search from an airport to itself.
        from: from.filter((airport) => airport.code !== destination),
        to: to.filter((airport) => airport.code !== origin),
      };
    },
  });
  const found = nearby.data;
  if (!found || (found.from.length === 0 && found.to.length === 0)) return null;

  const row = (label: string, end: 'from' | 'to', airports: Nearby) =>
    airports.length === 0 ? null : (
      <View className="gap-1">
        <Text className="font-body-bold text-body-sm text-heading">{label}</Text>
        <View className="flex-row flex-wrap gap-2">
          {airports.map((airport) => (
            <Button
              key={airport.code}
              testID={`nearby-${end}-${airport.code}`}
              variant="ghost"
              onPress={() =>
                onChoose(end === 'from' ? { from: airport.code } : { to: airport.code })
              }
            >
              {t('results.nearby.airport', {
                name: airport.name,
                code: airport.code,
                distance: airport.distanceKm,
              })}
            </Button>
          ))}
        </View>
      </View>
    );

  return (
    <View testID="nearby-airports" className="gap-2">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('results.nearby.heading')}
      </Text>
      {row(t('results.nearby.from'), 'from', found.from)}
      {row(t('results.nearby.to'), 'to', found.to)}
    </View>
  );
}
