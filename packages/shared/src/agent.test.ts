import { describe, expect, it } from 'vitest';

import {
  AGENT_NAMES,
  AGENT_SCOPES,
  AGENT_TOOL_NAME_PATTERN,
  CUSTOMER_AGENTS,
  STAFF_AGENTS,
  STAFF_SCOPE_PERMISSIONS,
  agentAudience,
  agentAutonomyKey,
  agentScopesFor,
  agentsFor,
  effectiveAutonomy,
  isForbiddenAgentTool,
  raisesAutonomy,
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

  it('refuses the names of things an agent never does (ADR-107)', () => {
    for (const name of [
      'refunds.approve',
      'finance.approve_refund',
      'refunds.send',
      'payments.capture',
      'payments.charge',
      'bookings.capture_payment',
      'payouts.send',
      'drivers.pay_out',
      'ledger.post',
      'finance.post_entry',
      'pricing.update',
      'markups.create',
      'fees.set',
      'tax_rules.change',
      'contracts.sign',
      'suppliers.accept_terms',
      'bookings.confirm',
      'bookings.mark_paid',
      'approvals.approve',
      'quotes.approve',
    ]) {
      expect([name, isForbiddenAgentTool(name)]).toEqual([name, true]);
    }
    for (const name of [
      'catalog.places',
      'platform.status',
      'flights.search',
      'bookings.read',
      'bookings.request_cancellation',
      'refunds.draft_request',
      'quotes.request_assisted',
      'payments.explain',
      'support.hand_over',
      'pricing.read',
    ]) {
      expect([name, isForbiddenAgentTool(name)]).toEqual([name, false]);
      expect(AGENT_TOOL_NAME_PATTERN.test(name)).toBe(true);
    }
    expect(AGENT_TOOL_NAME_PATTERN.test('Bookings.read')).toBe(false);
    expect(AGENT_TOOL_NAME_PATTERN.test('read')).toBe(false);
    expect(AGENT_TOOL_NAME_PATTERN.test('a.b.c')).toBe(false);
  });

  it('runs a call at the stricter of the agent and the tool level', () => {
    expect(effectiveAutonomy(undefined, undefined)).toBe('supervised');
    expect(effectiveAutonomy('autonomous', undefined)).toBe('supervised');
    expect(effectiveAutonomy('autonomous', 'autonomous')).toBe('autonomous');
    expect(effectiveAutonomy('autonomous', 'manual')).toBe('manual');
    expect(effectiveAutonomy('manual', 'autonomous')).toBe('manual');
    expect(raisesAutonomy('manual', 'supervised')).toBe(true);
    expect(raisesAutonomy('supervised', 'autonomous')).toBe(true);
    expect(raisesAutonomy('autonomous', 'supervised')).toBe(false);
    expect(raisesAutonomy('supervised', 'supervised')).toBe(false);
    expect(agentAutonomyKey('tool', 'quotes.request_assisted')).toBe(
      'autonomy.tool.quotes.request_assisted',
    );
  });
});
