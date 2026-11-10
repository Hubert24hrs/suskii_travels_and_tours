import { describe, expect, it } from 'vitest';

import {
  AGENT_NAMES,
  AGENT_SCOPES,
  CUSTOMER_AGENTS,
  STAFF_AGENTS,
  STAFF_SCOPE_PERMISSIONS,
  agentAudience,
  agentScopesFor,
  agentsFor,
  tierRuns,
} from './agent';
import { PERMISSIONS } from './rbac';

describe('agent catalogue (ADR-101, ADR-107)', () => {
  it('names every agent once, each for travellers or for staff', () => {
    expect(new Set(AGENT_NAMES).size).toBe(AGENT_NAMES.length);
    expect(AGENT_NAMES).toHaveLength(CUSTOMER_AGENTS.length + STAFF_AGENTS.length);
    expect(agentAudience('concierge')).toBe('customer');
    expect(agentAudience('finance_prep')).toBe('staff');
  });

  it('keeps staff agents to the console', () => {
    expect(agentsFor('console')).toEqual(STAFF_AGENTS);
    for (const channel of ['web', 'app', 'whatsapp'] as const) {
      expect(agentsFor(channel)).toEqual(CUSTOMER_AGENTS);
    }
  });

  it('lets reading run at every level and preparing only when staff asked for more than advice', () => {
    expect(tierRuns('read', 'manual')).toBe(true);
    expect(tierRuns('propose', 'manual')).toBe(false);
    expect(tierRuns('propose', 'supervised')).toBe(true);
    expect(tierRuns('commit', 'manual')).toBe(false);
    expect(tierRuns('commit', 'autonomous')).toBe(true);
  });
});

describe('agentScopesFor', () => {
  it('gives a guest public data, quotes and a person, and nothing of an account', () => {
    const scopes = agentScopesFor({ userId: null, roles: [], channel: 'web' });
    expect(scopes).toEqual(['catalog', 'search', 'quotes', 'support']);
    expect(scopes).not.toContain('account');
  });

  it('adds the account for a signed-in traveller, on every traveller channel', () => {
    for (const channel of ['web', 'app', 'whatsapp'] as const) {
      expect(agentScopesFor({ userId: 'u1', roles: ['customer'], channel })).toContain('account');
    }
  });

  it('never gives a traveller a staff scope, even with a staff role, outside the console', () => {
    const scopes = agentScopesFor({ userId: 'u1', roles: ['super_admin'], channel: 'web' });
    for (const scope of Object.keys(STAFF_SCOPE_PERMISSIONS)) expect(scopes).not.toContain(scope);
  });

  it('gives staff in the console only the scopes their permissions open', () => {
    const none = agentScopesFor({ userId: 'u1', roles: ['customer'], channel: 'console' });
    expect(none).toEqual([]);
    // Visa officers hold no `ai:read`.
    expect(agentScopesFor({ userId: 'u1', roles: ['visa_officer'], channel: 'console' })).toEqual(
      [],
    );
    const finance = agentScopesFor({ userId: 'u1', roles: ['finance'], channel: 'console' });
    expect(finance).toEqual(expect.arrayContaining(['finance', 'reports']));
    expect(finance).not.toContain('ops');
    expect(finance).not.toContain('datasources');
    expect(finance).not.toContain('account');
    const admin = agentScopesFor({ userId: 'u1', roles: ['super_admin'], channel: 'console' });
    expect(admin).toEqual(
      expect.arrayContaining(['ops', 'finance', 'marketing', 'reports', 'datasources']),
    );
  });

  it('names only scopes and permissions that exist', () => {
    for (const [scope, permission] of Object.entries(STAFF_SCOPE_PERMISSIONS)) {
      expect(AGENT_SCOPES).toContain(scope);
      expect(Object.keys(PERMISSIONS)).toContain(permission);
    }
  });
});
