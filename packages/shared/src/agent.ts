import { hasPermissions, isStaff, type Permission, type Role } from './rbac';

/**
 * Suskii Agent (ADR-101 to ADR-107): the names, tiers, scopes and limits the API, the agent
 * service and the clients share. Nothing here grants anything by itself: the API's tool gateway
 * decides from a sealed grant.
 */

/** Agents a traveller talks to; the concierge is the supervisor that routes to the others. */
export const CUSTOMER_AGENTS = [
  'concierge',
  'flights',
  'hotels',
  'cars',
  'tours',
  'trip_builder',
  'bookings',
  'payments',
  'support',
  'disruption',
] as const;

/** Agents for staff, in the console only. */
export const STAFF_AGENTS = [
  'price_intel',
  'operations',
  'finance_prep',
  'marketing',
  'business_intelligence',
  'executive',
] as const;

export const AGENT_NAMES = [...CUSTOMER_AGENTS, ...STAFF_AGENTS] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
export type AgentAudience = 'customer' | 'staff';

export const agentAudience = (agent: AgentName): AgentAudience =>
  (CUSTOMER_AGENTS as readonly string[]).includes(agent) ? 'customer' : 'staff';

/** Where a conversation happens. */
export const AGENT_CHANNELS = ['web', 'app', 'whatsapp', 'console'] as const;
export type AgentChannel = (typeof AGENT_CHANNELS)[number];

/**
 * What a tool may do (ADR-107). `read` has no side effect; `propose` makes a draft or a pending
 * approval; `commit` changes state and only ever asks the API for a confirmation a person taps.
 * Approving a refund, capturing a payment, paying out, posting to the ledger and changing a price
 * rule have no tier because they are never tools.
 */
export const AGENT_TOOL_TIERS = ['read', 'propose', 'commit'] as const;
export type AgentToolTier = (typeof AGENT_TOOL_TIERS)[number];

/**
 * How far an agent or a tool goes without a person: advice only, prepared for staff to approve,
 * or acting within limits (approved low-risk tools only).
 */
export const AGENT_AUTONOMY_LEVELS = ['manual', 'supervised', 'autonomous'] as const;
export type AgentAutonomy = (typeof AGENT_AUTONOMY_LEVELS)[number];
export const DEFAULT_AGENT_AUTONOMY: AgentAutonomy = 'supervised';

/**
 * Whether a tool of this tier runs at this autonomy level. Reading is always allowed (reading
 * the grant's own data is what a customer agent is for). `manual` gives advice only, so it
 * prepares nothing. A `commit` never runs from the gateway at any level: it becomes a
 * confirmation the traveller taps (ADR-107).
 */
export function tierRuns(tier: AgentToolTier, autonomy: AgentAutonomy): boolean {
  if (tier === 'read') return true;
  return autonomy !== 'manual';
}

/**
 * The parts of the platform a grant opens. A tool names the scopes it needs; a grant carries the
 * scopes its caller has.
 */
export const AGENT_SCOPES = [
  // Public reference data and searches: places, FAQs, visa rules, fares, hotels, cars.
  'catalog',
  'search',
  // Quotes and requests that commit nothing.
  'quotes',
  // The caller's own bookings, trips, payments and preferences (signed-in travellers).
  'account',
  // Handing over to a person.
  'support',
  // Staff.
  'ops',
  'finance',
  'marketing',
  'reports',
  'datasources',
] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

/** The permission behind each staff scope; every staff agent also needs `ai:read`. */
export const STAFF_SCOPE_PERMISSIONS = {
  ops: 'bookings:manage',
  finance: 'refunds:request',
  marketing: 'deals:manage',
  reports: 'reports:read',
  datasources: 'datasources:manage',
} as const satisfies Partial<Record<AgentScope, Permission>>;

const GUEST_SCOPES: readonly AgentScope[] = ['catalog', 'search', 'quotes', 'support'];

/**
 * The scopes a caller's grant carries on a channel. A guest reads public data and can ask for a
 * quote or a person; a signed-in traveller also reaches their own account; staff scopes exist
 * only in the console, only with `ai:read`, and only for the permissions the person holds.
 */
export function agentScopesFor(caller: {
  userId: string | null;
  roles: readonly Role[];
  channel: AgentChannel;
}): AgentScope[] {
  if (caller.channel === 'console') {
    if (!caller.userId || !isStaff(caller.roles) || !hasPermissions(caller.roles, ['ai:read'])) {
      return [];
    }
    const staff = (
      Object.keys(STAFF_SCOPE_PERMISSIONS) as (keyof typeof STAFF_SCOPE_PERMISSIONS)[]
    ).filter((scope) => hasPermissions(caller.roles, [STAFF_SCOPE_PERMISSIONS[scope]]));
    return ['catalog', 'search', ...staff];
  }
  return caller.userId ? [...GUEST_SCOPES, 'account'] : [...GUEST_SCOPES];
}

/** The agents a caller may reach on a channel: staff agents never answer outside the console. */
export function agentsFor(channel: AgentChannel): readonly AgentName[] {
  return channel === 'console' ? STAFF_AGENTS : CUSTOMER_AGENTS;
}

/** A traveller's message: long enough for a trip brief, short enough to bound a model call. */
export const AGENT_MESSAGE_MAX = 2000;
/** A stored answer. */
export const AGENT_ANSWER_MAX = 4000;
/** Messages in one conversation before a new one must be started. */
export const AGENT_CONVERSATION_MESSAGE_LIMIT = 200;
/** Open conversations one account may have. */
export const AGENT_OPEN_CONVERSATION_LIMIT = 20;

/** `S-…` is support (ADR-083) and `T-…` a trip (ADR-099); an agent conversation is `A-…`. */
export const AGENT_REFERENCE_PATTERN = /^A-[A-Z0-9]{6}$/;
