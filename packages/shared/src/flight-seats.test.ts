import { describe, expect, it } from 'vitest';

import { SEAT_DESIGNATOR_PATTERN, seatChoiceIssue } from './flight-seats';

describe('seat choices', () => {
  const choice = (flight: number, passengerIndex: number, designator: string) => ({
    flight,
    passengerIndex,
    designator,
  });

  it('takes one seat per traveller on each flight', () => {
    expect(
      seatChoiceIssue([choice(0, 0, '12A'), choice(0, 1, '12B'), choice(1, 0, '12A')], 2),
    ).toBeNull();
    expect(seatChoiceIssue([], 1)).toBeNull();
  });

  it('refuses a seat chosen twice, two seats for one traveller and a seat for a lap infant', () => {
    expect(seatChoiceIssue([choice(0, 0, '12A'), choice(0, 1, '12A')], 2)).toBe(
      'seat_chosen_twice',
    );
    expect(seatChoiceIssue([choice(0, 0, '12A'), choice(0, 0, '12B')], 2)).toBe(
      'two_seats_one_traveller',
    );
    // Two adults and a lap infant: the infant is the third traveller and has no seat.
    expect(seatChoiceIssue([choice(0, 2, '12C')], 2)).toBe('no_seat_for_infant');
  });

  it('reads designators as airlines print them', () => {
    for (const seat of ['1A', '12F', '104K']) expect(SEAT_DESIGNATOR_PATTERN.test(seat)).toBe(true);
    for (const seat of ['A1', '0A', '12', '12AB', '1234A', '12a'])
      expect(SEAT_DESIGNATOR_PATTERN.test(seat)).toBe(false);
  });
});
