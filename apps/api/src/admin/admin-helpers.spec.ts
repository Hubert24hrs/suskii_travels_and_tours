import { z } from 'zod';

import { ProblemDetailsException } from '../common/problem-details';

import { checkMerged, fieldChanges, hasChanges, sameJson } from './admin-helpers';

describe('admin helpers', () => {
  describe('fieldChanges', () => {
    it('records only the fields that changed, with old and new values', () => {
      const changes = fieldChanges(
        { value: 250, active: true, currency: null, verticals: ['flights'] },
        { value: 300, active: true, currency: 'NGN', verticals: ['flights'] },
      );
      expect(changes).toEqual({
        value: { from: 250, to: 300 },
        currency: { from: null, to: 'NGN' },
      });
      expect(hasChanges(changes)).toBe(true);
    });

    it('treats a missing previous value as null and compares arrays by content', () => {
      expect(fieldChanges({}, { verticals: [] })).toEqual({ verticals: { from: null, to: [] } });
      expect(hasChanges(fieldChanges({ verticals: ['tours'] }, { verticals: ['tours'] }))).toBe(
        false,
      );
    });

    it('records long text as changed without its content', () => {
      expect(fieldChanges({ answer: 'old text' }, { answer: 'new text' }, ['answer'])).toEqual({
        answer: { changed: true },
      });
    });
  });

  describe('sameJson', () => {
    it('ignores key order (jsonb reorders keys) but not values or array order', () => {
      expect(
        sameJson({ b: 1, a: { d: [1, 2], c: null } }, { a: { c: null, d: [1, 2] }, b: 1 }),
      ).toBe(true);
      expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
      expect(sameJson({ a: 1 }, { a: '1' })).toBe(false);
      expect(sameJson({ a: undefined, b: 1 }, { b: 1 })).toBe(true);
    });
  });

  describe('checkMerged', () => {
    const schema = z
      .object({ type: z.enum(['percentage', 'fixed']), currency: z.string().nullable() })
      .refine((value) => value.type === 'percentage' || value.currency !== null, {
        path: ['currency'],
        message: 'currency_required',
      });

    it('returns the parsed value', () => {
      expect(checkMerged(schema, { type: 'fixed', currency: 'NGN' })).toEqual({
        type: 'fixed',
        currency: 'NGN',
      });
    });

    it('answers 400 validation-failed with the issue paths, optionally under a field', () => {
      expect.assertions(3);
      try {
        checkMerged(schema, { type: 'fixed', currency: null }, 'content');
      } catch (error) {
        expect(error).toBeInstanceOf(ProblemDetailsException);
        const problem = error as ProblemDetailsException;
        expect(problem.getStatus()).toBe(400);
        expect(problem.extensions).toEqual({
          errors: [
            {
              location: 'body',
              path: 'content.currency',
              code: 'custom',
              message: 'currency_required',
            },
          ],
        });
      }
    });
  });
});
