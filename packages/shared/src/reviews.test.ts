import { describe, expect, it } from 'vitest';

import {
  isReviewableItemKind,
  reviewDisplayName,
  reviewFlags,
  reviewInputSchema,
  reviewScore,
} from './index';

describe('reviewFlags', () => {
  it('flags emails and phone numbers as contact details', () => {
    expect(reviewFlags(['Write to ada.obi@example.com'])).toEqual(['contact_details']);
    expect(reviewFlags(['Call me on +234 803 123 4567'])).toEqual(['contact_details']);
    expect(reviewFlags(['Ring 0803-123-4567 for rides'])).toEqual(['contact_details']);
  });

  it('flags links and bare domains', () => {
    expect(reviewFlags(['Cheaper at https://example.test/deal'])).toEqual(['link']);
    expect(reviewFlags(['See www.cheap-rooms.example'])).toEqual(['link']);
    expect(reviewFlags(['Book on cheaprooms.com instead'])).toEqual(['link']);
  });

  it('looks at every text and leaves ordinary reviews alone', () => {
    expect(reviewFlags([null, 'Lovely pool', undefined, 'Breakfast from 7 to 10'])).toEqual([]);
    expect(reviewFlags(['Room 214, 3 nights, 2 adults'])).toEqual([]);
    expect(reviewFlags(['Great', 'mail me: a@b.co'])).toEqual(['contact_details']);
  });
});

describe('reviewScore', () => {
  it('averages to one decimal and is null without ratings', () => {
    expect(reviewScore(0, 0)).toBeNull();
    expect(reviewScore(17, 2)).toBe(8.5);
    expect(reviewScore(26, 3)).toBe(8.7);
  });
});

describe('reviewDisplayName', () => {
  it('shows the first given name and the last initial', () => {
    expect(reviewDisplayName('Ada Chioma', 'obi')).toBe('Ada O.');
    expect(reviewDisplayName('ADEBAYO CHIOMA', 'OKAFOR')).toBe('Adebayo O.');
    expect(reviewDisplayName('  Musa ', '')).toBe('Musa');
  });
});

describe('reviewInputSchema', () => {
  it('needs a whole rating from 1 to 10 and turns empty texts into null', () => {
    const parsed = reviewInputSchema.parse({
      rating: 9,
      title: '  ',
      liked: ' The staff ',
      tripType: 'family',
      showName: true,
    });
    expect(parsed).toEqual({
      rating: 9,
      title: null,
      liked: 'The staff',
      disliked: null,
      tripType: 'family',
      showName: true,
    });
    for (const rating of [0, 11, 7.5]) {
      expect(
        reviewInputSchema.safeParse({ rating, tripType: 'solo', showName: false }).success,
      ).toBe(false);
    }
  });

  it('refuses texts over the limits', () => {
    const result = reviewInputSchema.safeParse({
      rating: 5,
      liked: 'x'.repeat(1001),
      tripType: 'solo',
      showName: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('isReviewableItemKind', () => {
  it('covers stays, trips, buses and rentals only', () => {
    expect(['hotel', 'package', 'tour', 'bus', 'rental'].every(isReviewableItemKind)).toBe(true);
    expect(['flight', 'visa', 'addon', 'ride', 'membership'].some(isReviewableItemKind)).toBe(
      false,
    );
  });
});
