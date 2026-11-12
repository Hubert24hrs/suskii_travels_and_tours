import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { cn } from '../lib/cn';

export interface DestinationCardProps {
  media: ReactNode;
  city: string;
  country: string;
  hotelsLabel: string;
  priceLabel: string;
  onPress: () => void;
  className?: string;
}

/** Whole card is one control; text sits on a solid scrim that keeps AA contrast on any photo. */
export function DestinationCard({
  media,
  city,
  country,
  hotelsLabel,
  priceLabel,
  onPress,
  className,
}: DestinationCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${city}, ${country}. ${hotelsLabel}, ${priceLabel}`}
      onPress={onPress}
      className={cn('overflow-hidden rounded-lg active:opacity-80', className)}
    >
      <View className="aspect-4/3 bg-skeleton">{media}</View>
      <View className="absolute inset-x-0 bottom-0 gap-1 bg-scrim p-4">
        <Text className="font-heading text-h4 text-on-scrim">{city}</Text>
        <Text className="font-body-medium text-body-sm text-on-scrim">{country}</Text>
        <Text className="font-body text-body-sm text-on-scrim">
          {hotelsLabel} · {priceLabel}
        </Text>
      </View>
    </Pressable>
  );
}
