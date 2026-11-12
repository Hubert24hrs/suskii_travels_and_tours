import type { Schemas } from '@suskii/api-client';

import { api } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { AppLink } from '../app-link';
import { Container } from '../layout/container';

type Incident = Schemas['StatusIncident'];

/** The open incident travellers should hear about first: major before minor, then newest. */
export function leadingIncident(incidents: readonly Incident[]): Incident | null {
  const open = incidents.filter((incident) => incident.resolvedAt === null);
  return open.find((incident) => incident.impact === 'major') ?? open[0] ?? null;
}

/**
 * A strip above the header on every page while an incident is open (ADR-087). Server-rendered
 * from the cached status read, with no JavaScript, and nothing at all when the API cannot say.
 */
export async function StatusBanner() {
  const status = await api.status();
  const incident = status ? leadingIncident(status.incidents) : null;
  if (!incident) return null;
  const { t } = await getI18n();
  return (
    <div
      role="status"
      data-testid="status-banner"
      className={
        incident.impact === 'major' ? 'bg-danger text-on-status' : 'bg-warning text-on-status'
      }
    >
      <Container className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 font-body text-body-sm">
        <span className="font-bold">{incident.title}</span>
        <AppLink href="/status" className="underline focus-visible:focus-ring">
          {t('status.bannerLink')}
        </AppLink>
      </Container>
    </div>
  );
}
