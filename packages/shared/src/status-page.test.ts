import { describe, expect, it } from 'vitest';

import { impactState, suppliersState, worstState } from './status-page';
import { statusIncidentCreateSchema, statusIncidentUpdateSchema } from './status-page-schemas';

describe('status page rules', () => {
  it('takes the worst state, operational for none', () => {
    expect(worstState([])).toBe('operational');
    expect(worstState(['operational', 'degraded'])).toBe('degraded');
    expect(worstState(['degraded', 'outage', 'operational'])).toBe('outage');
  });

  it('maps an incident impact to the state of its components', () => {
    expect(impactState('minor')).toBe('degraded');
    expect(impactState('major')).toBe('outage');
  });

  it('judges a vertical by how many of its suppliers fail', () => {
    expect(suppliersState(2, 0)).toBe('operational');
    expect(suppliersState(2, 1)).toBe('degraded');
    expect(suppliersState(2, 2)).toBe('outage');
    expect(suppliersState(0, 0)).toBe('outage');
  });
});

describe('incident input', () => {
  const valid = {
    title: '  Card payments failing  ',
    impact: 'major',
    components: ['payments'],
    status: 'investigating',
    message: 'Some card payments fail. Bank transfers work.',
  };

  it('accepts and trims a new incident', () => {
    expect(statusIncidentCreateSchema.parse(valid).title).toBe('Card payments failing');
  });

  it('refuses an incident opened as resolved, without components or with one twice', () => {
    expect(statusIncidentCreateSchema.safeParse({ ...valid, status: 'resolved' }).success).toBe(
      false,
    );
    expect(statusIncidentCreateSchema.safeParse({ ...valid, components: [] }).success).toBe(false);
    expect(
      statusIncidentCreateSchema.safeParse({ ...valid, components: ['search', 'search'] }).success,
    ).toBe(false);
    expect(
      statusIncidentCreateSchema.safeParse({ ...valid, components: ['flights'] }).success,
    ).toBe(false);
  });

  it('refuses empty or overlong text', () => {
    expect(statusIncidentCreateSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false);
    expect(
      statusIncidentCreateSchema.safeParse({ ...valid, message: 'x'.repeat(2001) }).success,
    ).toBe(false);
  });

  it('accepts an update that resolves, optionally changing impact and components', () => {
    expect(
      statusIncidentUpdateSchema.parse({ status: 'resolved', message: 'Fixed.', impact: 'minor' }),
    ).toEqual({ status: 'resolved', message: 'Fixed.', impact: 'minor' });
  });
});
