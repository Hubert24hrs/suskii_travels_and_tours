import { qrPath } from './voucher-card';

describe('qrPath', () => {
  it('draws one unit square per dark module, deterministically', () => {
    const value = 'SUSKII-V1:U3N8DCNRNXZSNXDA293G';
    const first = qrPath(value);
    expect(first).toEqual(qrPath(value));
    // Version 2 (25 modules) for this payload at level M, plus a two-module quiet zone each side.
    expect(first.size).toBe(29);
    const squares = first.path.match(/M\d+ \d+h1v1h-1z/g) ?? [];
    expect(squares.length).toBeGreaterThan(100);
    expect(squares.join('')).toBe(first.path);
    // The quiet zone stays empty: no square starts in the first two rows or columns.
    expect(first.path).not.toMatch(/M[01] /);
    expect(first.path).not.toMatch(/M\d+ [01]h/);
  });

  it('changes with the payload', () => {
    expect(qrPath('SUSKII-V1:AAAAAAAAAAAAAAAAAAAA').path).not.toBe(
      qrPath('SUSKII-V1:BBBBBBBBBBBBBBBBBBBB').path,
    );
  });
});
