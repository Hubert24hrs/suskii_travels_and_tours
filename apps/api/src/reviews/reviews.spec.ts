import type { BookingItemRecord } from '../bookings/booking-presenter';
import type { ItemPayload } from '../bookings/booking-pricing';
import type { PrismaService } from '../infra/prisma.service';

import { HotelReviewLookup } from './hotel-review-lookup';
import { reviewableKind, subjectRefOf } from './review-subjects';
import { presentSummary } from './review-summary';
import { addDays, reviewableItem } from './reviews.service';

const hotel = (name = 'Eko Hotel & Suites', latitude = 6.4253, longitude = 3.4284) =>
  ({
    kind: 'hotel',
    hotel: { name, latitude, longitude, countryCode: 'NG', cityName: 'Lagos' },
    request: {
      checkIn: '2026-10-20',
      checkOut: '2026-10-23',
      rooms: [{ adults: 2, childAges: [] }],
    },
  }) as unknown as ItemPayload;

const travellers = { adults: 1, children: 0, infants: 0 };
const tour = {
  kind: 'tour',
  productId: '0192f0aa-0000-7000-8000-000000000001',
  title: 'Lekki Conservation Centre walk',
  cityName: 'Lagos',
  timeZone: 'Africa/Lagos',
  countryCode: 'NG',
  startsAtLocal: '2026-10-21T09:00',
  travellers,
} as unknown as ItemPayload;
const bus = {
  kind: 'bus',
  tripId: '0192f0aa-0000-7000-8000-000000000002',
  operatorName: 'GUO Transport',
  title: 'Lagos to Abuja',
  departsAtLocal: '2026-10-20T06:00',
  arrivesAtUtc: '2026-10-20T17:00:00.000Z',
  timeZone: 'Africa/Lagos',
  travellers,
} as unknown as ItemPayload;
const rental = {
  kind: 'rental',
  vehicleId: '0192f0aa-0000-7000-8000-000000000003',
  title: 'Toyota Corolla',
  pickupAtLocal: '2026-10-18T10:00',
  returnAtLocal: '2026-10-22T10:00',
  travellers,
} as unknown as ItemPayload;
const flight = { kind: 'flight', offer: { slices: [] } } as unknown as ItemPayload;
const visa = { kind: 'visa', travelDate: '2026-10-20', travellers } as unknown as ItemPayload;

const item = (payload: ItemPayload) => ({ id: 'item-1', payload }) as unknown as BookingItemRecord;
const confirmed = { status: 'CONFIRMED' } as const;

describe('verified review subjects (ADR-077)', () => {
  it('reviews stays, packages, tours, buses and rentals only', () => {
    expect(reviewableKind(hotel())).toBe('hotel');
    expect(reviewableKind(tour)).toBe('tour');
    expect(reviewableKind(bus)).toBe('bus');
    expect(reviewableKind(rental)).toBe('rental');
    expect(reviewableKind(flight)).toBeNull();
    expect(reviewableKind(visa)).toBeNull();
  });

  it('attaches each item to what travellers would recognise', () => {
    expect(subjectRefOf(hotel())).toEqual({
      kind: 'hotel',
      name: 'Eko Hotel & Suites',
      nameKey: 'eko suites',
      latitude: 6.4253,
      longitude: 3.4284,
    });
    expect(subjectRefOf(tour)).toEqual({
      kind: 'tour',
      refId: '0192f0aa-0000-7000-8000-000000000001',
      name: 'Lekki Conservation Centre walk',
    });
    // The operator, found through the trip when the review is stored.
    expect(subjectRefOf(bus)).toEqual({
      kind: 'bus_operator',
      tripId: '0192f0aa-0000-7000-8000-000000000002',
      name: 'GUO Transport',
    });
    expect(subjectRefOf(rental)).toMatchObject({ kind: 'rental_vehicle', name: 'Toyota Corolla' });
    expect(subjectRefOf(flight)).toBeNull();
    // A hotel whose name normalises to nothing cannot be matched, so it is not reviewable.
    expect(subjectRefOf(hotel('The Hotel'))).toBeNull();
  });
});

describe('who can review, and when (ADR-077)', () => {
  const windowDays = 90;

  it('opens the day after the trip ends, for a confirmed booking', () => {
    // Checked out on 23 October.
    expect(reviewableItem(confirmed, item(hotel()), windowDays, '2026-10-23')).toMatchObject({
      endsOn: '2026-10-23',
      canReview: false,
    });
    expect(reviewableItem(confirmed, item(hotel()), windowDays, '2026-10-24')).toMatchObject({
      kind: 'hotel',
      endsOn: '2026-10-23',
      windowEndsOn: '2027-01-21',
      canReview: true,
    });
    // A bus that arrives after midnight in Lagos ends the next day.
    expect(
      reviewableItem(
        confirmed,
        item({ ...bus, arrivesAtUtc: '2026-10-20T23:30:00.000Z' } as ItemPayload),
        windowDays,
        '2026-10-21',
      ),
    ).toMatchObject({ endsOn: '2026-10-21', canReview: false });
  });

  it('closes when the window ends', () => {
    expect(
      reviewableItem(confirmed, item(tour), windowDays, addDays('2026-10-21', 90)),
    ).toMatchObject({ canReview: true });
    expect(
      reviewableItem(confirmed, item(tour), windowDays, addDays('2026-10-21', 91)),
    ).toMatchObject({ canReview: false });
  });

  it('needs a confirmed booking', () => {
    for (const status of ['CANCELLED', 'REFUNDED', 'PAID', 'REFUND_PENDING'] as const) {
      expect(reviewableItem({ status }, item(rental), windowDays, '2026-11-01')?.canReview).toBe(
        false,
      );
    }
  });

  it('never offers flights, visas or add-ons', () => {
    expect(reviewableItem(confirmed, item(flight), windowDays, '2026-11-01')).toBeNull();
    expect(reviewableItem(confirmed, item(visa), windowDays, '2026-11-01')).toBeNull();
  });

  it('adds whole calendar days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });
});

describe('verified scores', () => {
  it('stays hidden until a review is published', () => {
    expect(presentSummary({ id: 's', ratingSum: 0, ratingCount: 0 })).toBeNull();
    expect(presentSummary({ id: 's', ratingSum: 26, ratingCount: 3 })).toEqual({
      subjectId: 's',
      score: 8.7,
      count: 3,
    });
  });

  describe('on hotel results', () => {
    const subject = {
      id: '0192f0aa-0000-7000-8000-0000000000aa',
      nameKey: 'eko suites',
      latitude: 6.4253,
      longitude: 3.4284,
      ratingSum: 17,
      ratingCount: 2,
    };
    const lookup = (findMany: jest.Mock) =>
      new HotelReviewLookup({ reviewSubject: { findMany } } as unknown as PrismaService);

    it('matches the same hotel from another supplier, by name within 250 m', async () => {
      const findMany = jest.fn().mockResolvedValue([subject]);
      const results = await lookup(findMany).forHotels([
        { name: 'EKO HOTEL AND SUITES', latitude: 6.4262, longitude: 3.4284 },
        // Same name in another city.
        { name: 'Eko Hotel & Suites', latitude: 9.0579, longitude: 7.4951 },
        { name: 'Radisson Blu Anchorage', latitude: 6.4318, longitude: 3.4215 },
      ]);
      expect(results).toEqual([{ subjectId: subject.id, score: 8.5, count: 2 }, null, null]);
      // One query per page, for the names on it.
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findMany.mock.calls[0][0]).toMatchObject({
        where: {
          kind: 'hotel',
          nameKey: { in: ['eko suites', 'radisson blu anchorage'] },
          ratingCount: { gt: 0 },
        },
      });
    });

    it('never fails a search', async () => {
      const findMany = jest.fn().mockRejectedValue(new Error('database down'));
      await expect(
        lookup(findMany).forHotels([{ name: 'Eko Hotel', latitude: 6.4, longitude: 3.4 }]),
      ).resolves.toEqual([null]);
      const unused = jest.fn();
      await expect(lookup(unused).forHotels([])).resolves.toEqual([]);
      expect(unused).not.toHaveBeenCalled();
    });
  });
});
