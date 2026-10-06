import { describe, expect, it } from 'vitest';

import { adminMessages } from './admin';
import { createTranslator } from './translator';

function leaves(tree: object, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : leaves(value as object, `${prefix}${key}.`),
  );
}

describe('admin catalog', () => {
  it('has no empty or untrimmed messages', () => {
    for (const [key, value] of leaves(adminMessages)) {
      expect({ key, value: value.trim().length > 0 && value === value.trim() }).toEqual({
        key,
        value: true,
      });
    }
  });

  it('balances placeholder braces', () => {
    for (const [key, value] of leaves(adminMessages)) {
      const opens = value.split('{').length;
      const closes = value.split('}').length;
      expect({ key, balanced: opens === closes }).toEqual({ key, balanced: true });
    }
  });

  it('formats plurals and placeholders', () => {
    const { t } = createTranslator(adminMessages, 'en-NG');
    expect(t('promos.redemptions', { count: 1 })).toBe('1 use');
    expect(t('promos.redemptions', { count: 1200 })).toBe('1,200 uses');
    expect(t('nav.signedInAs', { name: 'Ada' })).toBe('Signed in as Ada');
  });
});
