import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { color } from '@suskii/design-tokens';
import { Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { useT } from '../../providers/app-provider';

type Hotel = Schemas['HotelSummary'];

/** The drawing's own units: pins are placed in a 16:9 box, whatever size it is shown at. */
const WIDTH = 96;
const HEIGHT = 54;
const MARGIN = 8;
const PIN = 4.5;

/**
 * Where each hotel sits in the drawing: east to the right, north up, distances true to each
 * other (a degree of longitude is shorter away from the equator).
 */
export function pinPositions(
  hotels: readonly Pick<Hotel, 'id' | 'latitude' | 'longitude'>[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (hotels.length === 0) return positions;
  const middle = hotels.reduce((sum, hotel) => sum + hotel.latitude, 0) / hotels.length;
  const shrink = Math.cos((middle * Math.PI) / 180);
  const points = hotels.map((hotel) => ({
    id: hotel.id,
    east: hotel.longitude * shrink,
    north: hotel.latitude,
  }));
  const east = points.map((point) => point.east);
  const north = points.map((point) => point.north);
  const [west, south] = [Math.min(...east), Math.min(...north)];
  const span = Math.max(Math.max(...east) - west, Math.max(...north) - south, 1e-6);
  const scale = Math.min(WIDTH - 2 * MARGIN, HEIGHT - 2 * MARGIN) / span;
  const offsetX = (WIDTH - (Math.max(...east) - west) * scale) / 2;
  const offsetY = (HEIGHT - (Math.max(...north) - south) * scale) / 2;
  for (const point of points) {
    positions.set(point.id, {
      x: Math.round((offsetX + (point.east - west) * scale) * 10) / 10,
      y: Math.round((HEIGHT - offsetY - (point.north - south) * scale) * 10) / 10,
    });
  }
  return positions;
}

/**
 * The hotels of a results page as pins (ADR-097): where they are in relation to each other,
 * not streets. No map tiles load, so nothing is sent to a map provider. A pin is a button; the
 * screen shows the chosen hotel under the drawing, and the list stays the full alternative.
 */
export function HotelMap({
  hotels,
  selected,
  onSelect,
}: {
  hotels: readonly Hotel[];
  selected: string | null;
  onSelect: (hotelId: string) => void;
}) {
  const { t } = useT();
  const format = useFormatters();
  const positions = pinPositions(hotels);
  // The chosen pin is drawn last, so it is never hidden under a neighbour.
  const ordered = [...hotels].sort((a, b) => Number(a.id === selected) - Number(b.id === selected));
  return (
    <View testID="hotel-map" className="gap-2">
      <View className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-primary-subtle">
        <Svg width="100%" height="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          {ordered.map((hotel) => {
            const position = positions.get(hotel.id);
            if (!position) return null;
            const chosen = hotel.id === selected;
            return (
              <G
                key={hotel.id}
                testID={`hotel-pin-${hotel.id}`}
                accessible
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                accessibilityLabel={t('results.map.pin', {
                  hotel: hotel.name,
                  price: format.money(hotel.cheapestRate.price.total),
                })}
                onPress={() => onSelect(hotel.id)}
              >
                <Circle
                  cx={position.x}
                  cy={position.y}
                  r={PIN}
                  fill={chosen ? color.primary : color.surface}
                  stroke={chosen ? color.surface : color.primary}
                  strokeWidth={1}
                />
                <Circle
                  cx={position.x}
                  cy={position.y}
                  r={1.5}
                  fill={chosen ? color.surface : color.primary}
                />
              </G>
            );
          })}
        </Svg>
      </View>
      <Text className="font-body text-caption text-muted">{t('results.map.note')}</Text>
    </View>
  );
}
