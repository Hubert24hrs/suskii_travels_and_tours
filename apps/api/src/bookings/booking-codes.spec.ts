import { BOOKING_REFERENCE_ALPHABET } from '@suskii/shared';

import { uuidv7 } from '../common/uuid';

import { bookingReference, documentHint, maskEmail, maskPhone } from './booking-codes';

describe('booking codes', () => {
  it('makes six-character references from the unambiguous alphabet', () => {
    const references = new Set(Array.from({ length: 200 }, () => bookingReference()));
    expect(references.size).toBeGreaterThan(195);
    for (const reference of references) {
      expect(reference).toHaveLength(6);
      expect([...reference].every((char) => BOOKING_REFERENCE_ALPHABET.includes(char))).toBe(true);
    }
  });

  it('masks contact details and passport numbers', () => {
    expect(maskEmail('ngozi@example.com')).toBe('n***@example.com');
    expect(maskEmail('broken')).toBe('***');
    expect(maskPhone('+2348012345678')).toBe('+234*******678');
    expect(maskPhone('+12345')).toBe('***');
    expect(documentHint('A12345678')).toBe('678');
  });
});

describe('uuidv7', () => {
  it('is a version 7, variant 1 UUID that sorts by creation time', () => {
    const first = uuidv7(Date.UTC(2026, 8, 29, 12));
    const second = uuidv7(Date.UTC(2026, 8, 29, 12, 0, 0, 1));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first < second).toBe(true);
    expect(first.slice(0, 13).replace('-', '')).toBe(
      Date.UTC(2026, 8, 29, 12).toString(16).padStart(12, '0'),
    );
  });
});
