/**
 * The public status page (ADR-087): what a traveller can do (search, book, pay, sign in, get
 * help), how well each works now, and the incidents staff write about. Components never name a
 * supplier or payment provider.
 */
export const STATUS_COMPONENTS = ['search', 'bookings', 'payments', 'accounts', 'support'] as const;
export type StatusComponent = (typeof STATUS_COMPONENTS)[number];

/** Best first: `degraded` works slowly or in part, `outage` does not work. */
export const COMPONENT_STATES = ['operational', 'degraded', 'outage'] as const;
export type ComponentState = (typeof COMPONENT_STATES)[number];

/** `minor` makes the affected components degraded, `major` makes them an outage. */
export const STATUS_INCIDENT_IMPACTS = ['minor', 'major'] as const;
export type StatusIncidentImpact = (typeof STATUS_INCIDENT_IMPACTS)[number];

/** The usual incident stages; `resolved` closes the incident and accepts no further updates. */
export const STATUS_INCIDENT_STAGES = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
] as const;
export type StatusIncidentStage = (typeof STATUS_INCIDENT_STAGES)[number];

export const STATUS_INCIDENT_TITLE_MAX = 120;
export const STATUS_INCIDENT_MESSAGE_MAX = 2_000;
/** Resolved incidents stay on the page this long after they end. */
export const STATUS_RECENT_DAYS = 7;

const RANK: Record<ComponentState, number> = { operational: 0, degraded: 1, outage: 2 };

/** The worse of the states (`operational` for none). */
export const worstState = (states: readonly ComponentState[]): ComponentState =>
  states.reduce<ComponentState>(
    (worst, state) => (RANK[state] > RANK[worst] ? state : worst),
    'operational',
  );

/** What an open incident of this impact makes its components. */
export const impactState = (impact: StatusIncidentImpact): ComponentState =>
  impact === 'major' ? 'outage' : 'degraded';

/**
 * A vertical served by several suppliers: an outage when none can answer, degraded when some
 * cannot. No suppliers configured counts as an outage (nothing can be searched).
 */
export function suppliersState(total: number, failing: number): ComponentState {
  if (total === 0 || failing >= total) return 'outage';
  return failing > 0 ? 'degraded' : 'operational';
}
