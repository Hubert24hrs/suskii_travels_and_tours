import { useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { leadingIncident, useStatusQuery } from '../lib/status';
import { useT } from '../providers/app-provider';

/**
 * Names the open incident on Home and Trips and opens the status screen (ADR-087). Nothing while
 * all is well or while the status cannot be read.
 */
export function StatusBanner() {
  const { t } = useT();
  const router = useRouter();
  const status = useStatusQuery();
  const incident = status.data ? leadingIncident(status.data.incidents) : null;
  if (!incident) return null;
  return (
    <Pressable
      testID="status-banner"
      accessibilityRole="button"
      accessibilityHint={t('status.bannerLink')}
      onPress={() => router.push('/status')}
      className={`gap-1 rounded-lg p-4 ${incident.impact === 'major' ? 'bg-danger' : 'bg-warning'}`}
    >
      <Text className="font-body-bold text-body text-on-status">{incident.title}</Text>
      <Text className="font-body text-body-sm text-on-status underline">
        {t('status.bannerLink')}
      </Text>
    </Pressable>
  );
}
