import { useFormatters } from '@suskii/i18n/react';
import { DEFAULT_SEARCH_TIME_ZONE } from '@suskii/shared';
import { Badge, Card } from '@suskii/ui-native';
import { ScrollView, Text, View } from 'react-native';

import { Loading, Notice } from '../components/states';
import type { StatusIncident, StatusPage } from '../lib/status';
import { useStatusQuery } from '../lib/status';
import { useT } from '../providers/app-provider';

type State = StatusPage['state'];

const BADGE: Record<State, 'success' | 'warning' | 'danger'> = {
  operational: 'success',
  degraded: 'warning',
  outage: 'danger',
};

function IncidentCard({ incident }: { incident: StatusIncident }) {
  const { t } = useT();
  const format = useFormatters();
  const when = (instant: string) => format.dateTime(instant, DEFAULT_SEARCH_TIME_ZONE);
  return (
    <Card testID="status-incident" className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {incident.title}
      </Text>
      <Text className="font-body text-body-sm text-muted">
        {t('status.affects', {
          components: format.list(
            incident.components.map((component) => t(`status.components.${component}`)),
          ),
        })}
      </Text>
      <Text className="font-body text-body-sm text-muted">
        {t('status.started', { time: when(incident.startedAt) })}
        {incident.resolvedAt
          ? ` · ${t('status.resolvedAt', { time: when(incident.resolvedAt) })}`
          : ''}
      </Text>
      {incident.updates.map((update) => (
        <View key={`${update.createdAt}-${update.status}`} className="gap-1">
          <Text className="font-body-bold text-caption text-foreground">
            {t(`status.stages.${update.status}`)} · {when(update.createdAt)}
          </Text>
          <Text className="font-body text-body text-foreground">{update.message}</Text>
        </View>
      ))}
    </Card>
  );
}

/** Service status (ADR-087): each part of the service and the incidents of the last 7 days. */
export function StatusScreen() {
  const { t } = useT();
  const format = useFormatters();
  const status = useStatusQuery();
  if (status.isPending) return <Loading label={t('mobile.loading')} />;
  if (!status.data) {
    return (
      <Notice
        testID="status-unavailable"
        body={t('status.unavailable')}
        action={t('mobile.retry')}
        onAction={() => void status.refetch()}
      />
    );
  }
  const page = status.data;
  const open = page.incidents.filter((incident) => incident.resolvedAt === null);
  const recent = page.incidents.filter((incident) => incident.resolvedAt !== null);
  return (
    <ScrollView testID="status-screen" contentContainerClassName="gap-4 p-4 pb-12">
      <Text className="font-body text-body text-foreground">{t('status.intro')}</Text>
      <Card className="gap-2 p-4">
        <Text testID="status-overall" className="font-heading text-h4 text-heading">
          {t(`status.overall.${page.state}`)}
        </Text>
        <Text className="font-body text-body-sm text-muted">
          {t('status.updated', { time: format.dateTime(page.updatedAt, DEFAULT_SEARCH_TIME_ZONE) })}
        </Text>
      </Card>
      <Card className="gap-3 p-4">
        {page.components.map((component) => (
          <View
            key={component.id}
            testID={`status-${component.id}`}
            className="flex-row items-center justify-between gap-3"
          >
            <Text className="flex-1 font-body text-body text-foreground">
              {t(`status.components.${component.id}`)}
            </Text>
            <Badge variant={BADGE[component.state]}>{t(`status.states.${component.state}`)}</Badge>
          </View>
        ))}
      </Card>
      {open.length > 0 ? (
        <View className="gap-3">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('status.openHeading')}
          </Text>
          {open.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} />
          ))}
        </View>
      ) : null}
      <View className="gap-3">
        <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
          {t('status.recentHeading')}
        </Text>
        {recent.map((incident) => (
          <IncidentCard key={incident.id} incident={incident} />
        ))}
        {recent.length === 0 && open.length === 0 ? (
          <Text className="font-body text-body text-muted">{t('status.noIncidents')}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
