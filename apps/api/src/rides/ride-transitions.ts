import { Injectable } from '@nestjs/common';

import { nextRideStatus, type RideEvent, type RideStatus } from '@suskii/shared';

import type { Prisma } from '../generated/prisma/client';

import { rideConflict } from './ride-errors';

type Tx = Prisma.TransactionClient;

export interface RideActor {
  kind: 'rider' | 'driver' | 'staff' | 'system';
  userId?: string | null;
}

/**
 * The only way a ride's status changes (ADR-050): the shared state machine decides, a
 * conditional update on the current status makes concurrent actions race safely (the loser gets
 * 409 `ride-conflict`), and every move leaves a `ride_events` row with its actor.
 */
@Injectable()
export class RideTransitions {
  async apply(
    tx: Tx,
    ride: { id: string; status: RideStatus },
    event: RideEvent,
    actor: RideActor,
    options: {
      data?: Prisma.RideUpdateManyMutationInput & {
        driverId?: string | null;
        vehicleId?: string | null;
      };
      metadata?: Prisma.InputJsonObject;
    } = {},
  ): Promise<RideStatus> {
    const to = nextRideStatus(ride.status, event);
    if (!to) throw rideConflict();
    const { driverId, vehicleId, ...data } = options.data ?? {};
    const updated = await tx.ride.updateMany({
      where: { id: ride.id, status: ride.status },
      data: {
        ...data,
        ...(driverId !== undefined ? { driverId } : {}),
        ...(vehicleId !== undefined ? { vehicleId } : {}),
        status: to,
      },
    });
    if (updated.count !== 1) throw rideConflict();
    await tx.rideEvent.create({
      data: {
        rideId: ride.id,
        event,
        fromStatus: ride.status,
        toStatus: to,
        actorKind: actor.kind,
        actorUserId: actor.userId ?? null,
        metadata: options.metadata ?? {},
      },
    });
    return to;
  }
}
