import { createTranslator, getMessages } from '@suskii/i18n';

import { toFieldErrors } from './form-issues';

const { t } = createTranslator(getMessages('en-NG'), 'en-NG');
const issues = getMessages('en-NG').search.issues;

describe('toFieldErrors', () => {
  it('uses the specific message for known schema issues', () => {
    expect(
      toFieldErrors(
        [{ path: ['destination'], message: 'same_origin_destination' }],
        { origin: 'LOS', destination: 'LOS' },
        t,
      ),
    ).toEqual({ destination: issues.same_origin_destination });
  });

  it('tells empty fields from invalid ones, one message per field', () => {
    expect(
      toFieldErrors(
        [
          { path: ['legs', 1, 'origin'], message: 'Too small' },
          { path: ['legs', 1, 'origin'], message: 'Invalid' },
          { path: ['departureDate'], message: 'Invalid date' },
        ],
        { legs: [{ origin: 'LOS' }, { origin: '' }], departureDate: '2026-13-40' },
        t,
      ),
    ).toEqual({ 'legs.1.origin': issues.required, departureDate: issues.invalid });
  });
});
