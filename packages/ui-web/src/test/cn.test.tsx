import { describe, expect, it } from 'vitest';

import { cn } from '../lib/cn';

describe('cn', () => {
  it('keeps a font size and a colour that share the text- prefix', () => {
    expect(cn('text-h2', 'text-primary')).toBe('text-h2 text-primary');
  });

  it('resolves conflicts between token utilities, later classes winning', () => {
    expect(cn('p-4', 'p-6')).toBe('p-6');
    expect(cn('bg-surface', 'bg-primary')).toBe('bg-primary');
    expect(cn('rounded-lg', 'rounded-pill')).toBe('rounded-pill');
  });

  it('lets a narrower container width override the page width', () => {
    expect(cn('mx-auto max-w-page px-4', 'max-w-dialog')).toBe('mx-auto px-4 max-w-dialog');
  });
});
