import { primeBenefitsSchema, type PrimeBenefits } from '@suskii/shared';

import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../infra/prisma.service';
import type { ClientContext } from '../search/client-context';

type Reader = Pick<Prisma.TransactionClient, 'primeMembership'> | PrismaService;

export interface PrimeStatus {
  membershipId: string;
  planId: string;
  /** The end of the last consecutive paid term (extensions start where the previous ends). */
  until: Date;
  /** Benefits of the term covering now (snapshotted at purchase). */
  benefits: PrimeBenefits;
}

/** Benefits as stored on a term; a malformed snapshot grants nothing rather than failing. */
export function storedBenefits(value: unknown): PrimeBenefits {
  const parsed = primeBenefitsSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : { markupShareBps: 0, waivedFeeCodes: [], prioritySupport: false };
}

/** The user's Suskii Prime membership now, or null (ADR-030). */
export async function currentPrime(
  reader: Reader,
  userId: string,
  now = new Date(),
): Promise<PrimeStatus | null> {
  const terms = await reader.primeMembership.findMany({
    where: { userId, status: 'active', endsAt: { gt: now } },
    orderBy: { startsAt: 'asc' },
    select: { id: true, planId: true, startsAt: true, endsAt: true, benefits: true },
  });
  const current = terms.find((term) => term.startsAt <= now);
  if (!current) return null;
  let until = current.endsAt;
  for (const term of terms) {
    if (term.startsAt <= until && term.endsAt > until) until = term.endsAt;
  }
  return {
    membershipId: current.id,
    planId: current.planId,
    until,
    benefits: storedBenefits(current.benefits),
  };
}

/**
 * The pricing client with the tier read from the database: quotes, bookings and the payment
 * re-check use it, so a membership that ended a minute ago never prices a booking.
 */
export async function withCurrentTier(
  reader: Reader,
  client: ClientContext,
  now = new Date(),
): Promise<ClientContext> {
  if (!client.userId) return { ...client, userTier: 'guest', benefits: null };
  const prime = await currentPrime(reader, client.userId, now);
  return prime
    ? { ...client, userTier: 'prime', benefits: prime.benefits }
    : { ...client, userTier: 'member', benefits: null };
}
