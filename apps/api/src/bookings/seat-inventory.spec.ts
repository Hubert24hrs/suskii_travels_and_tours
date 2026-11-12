import { Prisma } from '../generated/prisma/client';
import { claimRental, overlapViolation } from './seat-inventory';

const known = (code: string, meta: Record<string, unknown>, message = 'refused') =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test', meta });

/** What the pg driver adapter reports for a Postgres error it maps to a write conflict. */
const writeConflict = (originalCode: string) =>
  known(
    'P2034',
    {
      driverAdapterError: {
        cause: { kind: 'TransactionWriteConflict', originalCode, originalMessage: 'refused' },
      },
    },
    'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
  );

describe('overlapViolation', () => {
  it('recognises the exclusion constraint by name or code', () => {
    expect(
      overlapViolation(
        new Error(
          'conflicting key value violates exclusion constraint "rental_reservations_no_overlap"',
        ),
      ),
    ).toBe(true);
    expect(overlapViolation(known('P2010', { code: '23P01' }))).toBe(true);
  });

  it('treats a deadlock between two overlapping inserts as the same refusal', () => {
    expect(overlapViolation(writeConflict('40P01'))).toBe(true);
  });

  it('leaves other errors alone, serialization failures included', () => {
    expect(overlapViolation(writeConflict('40001'))).toBe(false);
    expect(overlapViolation(known('P2034', {}))).toBe(false);
    expect(overlapViolation(known('P2002', { target: ['booking_item_id'] }))).toBe(false);
    expect(overlapViolation(new Error('connection lost'))).toBe(false);
  });
});

describe('claimRental', () => {
  const payload = {
    vehicleId: 'vehicle-1',
    pickupAtUtc: '2027-01-10T09:00:00.000Z',
    returnAtUtc: '2027-01-11T09:00:00.000Z',
    chauffeur: false,
    charge: { deposit: { minor: 5_000_000n, currency: 'NGN' } },
  };
  const txThrowing = (error: unknown) =>
    ({
      rentalReservation: { create: jest.fn().mockRejectedValue(error) },
    }) as unknown as Prisma.TransactionClient;

  it('answers 409 vehicle-unavailable when it loses a deadlock to an overlapping booking', async () => {
    await expect(
      claimRental(txThrowing(writeConflict('40P01')), payload, 'item-1', {
        RENTAL_TURNAROUND_HOURS: 2,
      }),
    ).rejects.toMatchObject({ status: 409, slug: 'vehicle-unavailable' });
  });

  it('rethrows anything else', async () => {
    const error = new Error('connection lost');
    await expect(
      claimRental(txThrowing(error), payload, 'item-1', { RENTAL_TURNAROUND_HOURS: 2 }),
    ).rejects.toBe(error);
  });
});
