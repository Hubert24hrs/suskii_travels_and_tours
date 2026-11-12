import type { Schemas } from '@suskii/api-client';
import { DEFAULT_SEARCH_TIME_ZONE } from '@suskii/shared';
import { Card } from '@suskii/ui-web';
import type { Metadata } from 'next';

import { Breadcrumbs } from '../../components/breadcrumbs';
import { Container } from '../../components/layout/container';
import { api } from '../../lib/api';
import { getI18n, type I18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

type StatusPage = Schemas['StatusPage'];
type Incident = StatusPage['incidents'][number];
type State = StatusPage['state'];

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('status.heading'),
    description: t('status.intro'),
    path: '/status',
  });
}

const STATE_CLASS: Record<State, string> = {
  operational: 'bg-success text-on-status',
  degraded: 'bg-warning text-on-status',
  outage: 'bg-danger text-on-status',
};

function IncidentCard({ incident, i18n }: { incident: Incident; i18n: I18n }) {
  const { t, format } = i18n;
  const when = (instant: string) => format.dateTime(instant, DEFAULT_SEARCH_TIME_ZONE);
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="font-heading text-h4 font-bold text-heading">{incident.title}</h3>
        <p className="font-body text-body-sm text-muted">
          {t('status.affects', {
            components: format.list(
              incident.components.map((component) => t(`status.components.${component}`)),
            ),
          })}
        </p>
        <p className="font-body text-body-sm text-muted">
          {t('status.started', { time: when(incident.startedAt) })}
          {incident.resolvedAt
            ? ` · ${t('status.resolvedAt', { time: when(incident.resolvedAt) })}`
            : null}
        </p>
      </div>
      <ol className="flex flex-col gap-3 border-s-2 border-border ps-4">
        {incident.updates.map((update) => (
          <li key={`${update.createdAt}-${update.status}`} className="flex flex-col gap-1">
            <p className="font-body text-caption font-bold text-foreground">
              {t(`status.stages.${update.status}`)} · {when(update.createdAt)}
            </p>
            <p className="font-body text-body text-foreground">{update.message}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * The public status page (ADR-087): the overall state, each part of the service, open incidents
 * with their updates and those resolved in the last 7 days. Rendered per request like every page
 * (the nonce CSP); the API's answer is cached for 30 seconds.
 */
export default async function StatusRoute() {
  const i18n = await getI18n();
  const { t, format } = i18n;
  const status = await api.status();
  const open = status?.incidents.filter((incident) => incident.resolvedAt === null) ?? [];
  const recent = status?.incidents.filter((incident) => incident.resolvedAt !== null) ?? [];
  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <Breadcrumbs items={[{ name: t('status.heading'), path: '/status' }]} />
      <div className="flex max-w-dialog flex-col gap-3">
        <h1 className="font-heading text-h2 font-extrabold text-heading">{t('status.heading')}</h1>
        <p className="font-body text-body text-foreground">{t('status.intro')}</p>
      </div>
      {status ? (
        <>
          <div
            data-testid="status-overall"
            className={`flex flex-col gap-1 rounded-lg p-5 ${STATE_CLASS[status.state]}`}
          >
            <p className="font-heading text-h3 font-bold">{t(`status.overall.${status.state}`)}</p>
            <p className="font-body text-body-sm">
              {t('status.updated', {
                time: format.dateTime(status.updatedAt, DEFAULT_SEARCH_TIME_ZONE),
              })}
            </p>
          </div>
          <Card className="p-0">
            <ul className="flex flex-col">
              {status.components.map((component) => (
                <li
                  key={component.id}
                  className="flex items-center justify-between gap-4 border-b border-border p-4 last:border-b-0"
                >
                  <span className="font-body text-body text-foreground">
                    {t(`status.components.${component.id}`)}
                  </span>
                  <span
                    data-testid={`status-${component.id}`}
                    className={`rounded-full px-3 py-1 font-body text-caption font-bold ${STATE_CLASS[component.state]}`}
                  >
                    {t(`status.states.${component.state}`)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          {open.length > 0 ? (
            <section aria-labelledby="status-open" className="flex flex-col gap-4">
              <h2 id="status-open" className="font-heading text-h3 font-bold text-heading">
                {t('status.openHeading')}
              </h2>
              {open.map((incident) => (
                <IncidentCard key={incident.id} incident={incident} i18n={i18n} />
              ))}
            </section>
          ) : null}
          <section aria-labelledby="status-recent" className="flex flex-col gap-4">
            <h2 id="status-recent" className="font-heading text-h3 font-bold text-heading">
              {t('status.recentHeading')}
            </h2>
            {recent.length > 0 ? (
              recent.map((incident) => (
                <IncidentCard key={incident.id} incident={incident} i18n={i18n} />
              ))
            ) : open.length === 0 ? (
              <p className="font-body text-body text-muted">{t('status.noIncidents')}</p>
            ) : null}
          </section>
        </>
      ) : (
        <p role="alert" className="font-body text-body text-foreground">
          {t('status.unavailable')}
        </p>
      )}
    </Container>
  );
}
