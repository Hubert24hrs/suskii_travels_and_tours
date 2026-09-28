import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Badge } from './badge';
import { Button } from './button';
import { Card } from './card';

export interface DealCardProps {
  /** 16:9 image (e.g. expo-image). Decorative. */
  media: ReactNode;
  originCode: string;
  destinationCode: string;
  /** Screen-reader route, e.g. "Lagos to London". */
  routeLabel: string;
  airlineName: string;
  airlineLogo?: ReactNode;
  dates: string;
  cabin: string;
  priceLabel: string;
  discountLabel?: string | undefined;
  /** Quote freshness (pricing guardrails). */
  updatedLabel: string;
  ctaLabel: string;
  onPress: () => void;
  className?: string;
}

export function DealCard({
  media,
  originCode,
  destinationCode,
  routeLabel,
  airlineName,
  airlineLogo,
  dates,
  cabin,
  priceLabel,
  discountLabel,
  updatedLabel,
  ctaLabel,
  onPress,
  className,
}: DealCardProps) {
  return (
    <Card className={className}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="aspect-video overflow-hidden rounded-t-lg bg-skeleton"
      >
        {media}
      </View>
      <View className="gap-2 p-4">
        <View className="flex-row items-start justify-between gap-2">
          <Text
            accessibilityRole="header"
            accessibilityLabel={routeLabel}
            className="font-heading text-h4 text-heading"
          >
            {originCode} → {destinationCode}
          </Text>
          {discountLabel ? <Badge variant="promo">{discountLabel}</Badge> : null}
        </View>
        <View className="flex-row items-center gap-2">
          {airlineLogo}
          <Text className="font-body text-body-sm text-foreground">{airlineName}</Text>
        </View>
        <Text className="font-body text-body-sm text-muted">
          {dates} · {cabin}
        </Text>
        <Text className="font-heading-extrabold text-h3 text-primary">{priceLabel}</Text>
        <Text className="font-body text-caption text-muted">{updatedLabel}</Text>
        <Button variant="secondary" fullWidth onPress={onPress} className="mt-2">
          {ctaLabel}
        </Button>
      </View>
    </Card>
  );
}
