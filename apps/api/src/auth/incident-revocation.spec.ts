import { parseIncidentArgs } from './incident-revocation';

describe('parseIncidentArgs', () => {
  it('reads one scope, a reason slug and the confirmation', () => {
    expect(parseIncidentArgs(['--staff', '--reason', 'incident-2026-10-06'])).toEqual({
      scope: { kind: 'staff' },
      reason: 'incident-2026-10-06',
      confirm: false,
    });
    expect(parseIncidentArgs(['--all', '--reason', 'key-rotation', '--yes'])).toEqual({
      scope: { kind: 'all' },
      reason: 'key-rotation',
      confirm: true,
    });
    expect(
      parseIncidentArgs([
        '--user',
        '0192F0E0-0000-7000-8000-000000000001',
        '--reason',
        'account-takeover',
      ]).scope,
    ).toEqual({ kind: 'user', userId: '0192f0e0-0000-7000-8000-000000000001' });
  });

  it('refuses anything ambiguous', () => {
    expect(() => parseIncidentArgs(['--reason', 'incident'])).toThrow(/exactly one scope/);
    expect(() => parseIncidentArgs(['--all', '--staff', '--reason', 'incident'])).toThrow(
      /exactly one scope/,
    );
    expect(() => parseIncidentArgs(['--all'])).toThrow(/--reason/);
    expect(() => parseIncidentArgs(['--all', '--reason', 'Incident Report'])).toThrow(/--reason/);
    expect(() => parseIncidentArgs(['--user', 'someone', '--reason', 'incident'])).toThrow(
      /account id/,
    );
    expect(() => parseIncidentArgs(['--all', '--reason', 'incident', '--force'])).toThrow();
  });
});
