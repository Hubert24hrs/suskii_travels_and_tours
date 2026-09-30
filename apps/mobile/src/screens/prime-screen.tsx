import { Badge, Card } from '@suskii/ui-native';
import { ScrollView, Text, View } from 'react-native';

import { useT } from '../providers/app-provider';

/**
 * Suskii Prime arrives in phase 9 and its pricing is an owner decision, so this tab lists only
 * the benefits named in the spec, with no prices or dates.
 */
export function PrimeScreen() {
  const { t } = useT();
  const benefits = [
    t('mobile.prime.benefitPrices'),
    t('mobile.prime.benefitFees'),
    t('mobile.prime.benefitSupport'),
    t('mobile.prime.benefitWallet'),
  ];
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-12">
      <Card className="gap-3 p-4">
        <Badge variant="promo">{t('mobile.prime.badge')}</Badge>
        <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
          {t('mobile.prime.title')}
        </Text>
        <Text className="font-body text-body text-foreground">{t('mobile.prime.body')}</Text>
        <Text accessibilityRole="header" className="pt-2 font-body-bold text-body text-heading">
          {t('mobile.prime.benefitsHeading')}
        </Text>
        <View className="gap-2">
          {benefits.map((benefit) => (
            <Text key={benefit} className="font-body text-body text-foreground">
              • {benefit}
            </Text>
          ))}
        </View>
        <Text className="font-body text-caption text-muted">{t('mobile.prime.notice')}</Text>
      </Card>
    </ScrollView>
  );
}
