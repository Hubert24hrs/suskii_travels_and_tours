import { describe, expect, it } from 'vitest';

import {
  dealPercent,
  hotelCollections,
  medianMinor,
  type CollectionHotel,
} from './hotel-collections';

const hotel = (patch: Partial<CollectionHotel> = {}): CollectionHotel => ({
  stars: 3,
  reviewScore: 7.5,
  propertyType: 'hotel',
  amenities: ['wifi'],
  maxRoomGuests: 2,
  roomNames: ['Standard Room'],
  dealPercent: null,
  ...patch,
});

describe('medianMinor', () => {
  it('takes the middle value, or the mean of the two middle ones', () => {
    expect(medianMinor([])).toBeNull();
    expect(medianMinor([300n, 100n, 200n])).toBe(200n);
    expect(medianMinor([400n, 100n, 200n, 300n])).toBe(250n);
  });
});

describe('dealPercent', () => {
  const usual = [100_000n, 90_000n, 110_000n, 105_000n, 95_000n];

  it('says how far below the usual price of its class a hotel is', () => {
    // The usual price of the six is 97,500: 80,000 is 17.9% below it, counted in whole percent.
    expect(dealPercent(80_000n, [...usual, 80_000n], 8)).toBe(17);
    // Not far enough below, at the usual price, or above it.
    expect(dealPercent(90_000n, usual, 8)).toBeNull();
    expect(dealPercent(100_000n, usual, 8)).toBeNull();
    expect(dealPercent(120_000n, usual, 8)).toBeNull();
  });

  it('says nothing for a small class or a poorly rated hotel', () => {
    expect(dealPercent(50_000n, [100_000n, 90_000n, 50_000n], 9)).toBeNull();
    expect(dealPercent(70_000n, [...usual, 70_000n], 6.5)).toBeNull();
    // A hotel nobody has rated yet can still be a deal.
    expect(dealPercent(70_000n, [...usual, 70_000n], null)).toBe(28);
  });
});

describe('hotelCollections', () => {
  it('puts a plain hotel in none', () => {
    expect(hotelCollections(hotel())).toEqual([]);
  });

  it('finds family rooms by the guests they sleep or by name', () => {
    expect(hotelCollections(hotel({ maxRoomGuests: 4 }))).toEqual(['family']);
    expect(hotelCollections(hotel({ maxRoomGuests: null, roomNames: ['Family Suite'] }))).toEqual([
      'family',
    ]);
  });

  it('calls five stars luxury, and four only with an excellent score', () => {
    expect(hotelCollections(hotel({ stars: 5, reviewScore: null }))).toEqual(['luxury']);
    expect(hotelCollections(hotel({ stars: 4, reviewScore: 9.1 }))).toEqual(['luxury']);
    expect(hotelCollections(hotel({ stars: 4, reviewScore: 8.9 }))).toEqual([]);
  });

  it('suggests a well-rated four or five star hotel with a spa or a pool for a honeymoon', () => {
    expect(
      hotelCollections(hotel({ stars: 4, reviewScore: 8.2, amenities: ['wifi', 'spa'] })),
    ).toEqual(['honeymoon']);
    expect(
      hotelCollections(hotel({ stars: 4, reviewScore: 7.9, amenities: ['wifi', 'spa'] })),
    ).toEqual([]);
    expect(hotelCollections(hotel({ stars: 5, reviewScore: 9.4, amenities: ['pool'] }))).toEqual([
      'luxury',
      'honeymoon',
    ]);
  });

  it('suggests apartments and places with a kitchen or laundry for a long stay', () => {
    expect(hotelCollections(hotel({ propertyType: 'apartment' }))).toEqual(['long_stay']);
    expect(hotelCollections(hotel({ amenities: ['wifi', 'laundry'] }))).toEqual(['long_stay']);
    expect(hotelCollections(hotel({ propertyType: null }))).toEqual([]);
  });

  it('lists a deal first', () => {
    expect(hotelCollections(hotel({ dealPercent: 22, maxRoomGuests: 3 }))).toEqual([
      'deals',
      'family',
    ]);
    expect(hotelCollections(hotel({ dealPercent: 10 }))).toEqual([]);
  });
});
