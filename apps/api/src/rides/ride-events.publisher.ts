import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS } from '../infra/redis';

export const rideChannel = (rideId: string): string => `rides:${rideId}`;
export const driverChannel = (driverId: string): string => `driver:${driverId}`;

/** What realtime clients receive (ADR-052): ids, statuses, ETAs and rounded positions only. */
export type RideMessage =
  | { type: 'ride.updated'; rideId: string; status: string }
  | {
      type: 'ride.location';
      rideId: string;
      position: { lat: number; lng: number; at: string };
      etaSeconds: number | null;
    }
  | { type: 'offer.created'; offerId: string; rideId: string; expiresAt: string }
  | { type: 'offer.closed'; offerId: string; rideId: string; reason: string };

/**
 * Publishes ride changes to Redis after the database change commits, for every API replica's
 * WebSocket gateway to fan out (ADR-052). Delivery is best effort: a failed publish is logged and
 * clients re-read the ride over REST.
 */
@Injectable()
export class RideEventsPublisher {
  private readonly logger = new Logger(RideEventsPublisher.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async toRide(rideId: string, message: RideMessage): Promise<void> {
    await this.publish(rideChannel(rideId), message);
  }

  async toDriver(driverId: string, message: RideMessage): Promise<void> {
    await this.publish(driverChannel(driverId), message);
  }

  private async publish(channel: string, message: RideMessage): Promise<void> {
    try {
      await this.redis.publish(channel, JSON.stringify(message));
    } catch (error) {
      this.logger.warn(
        { reason: (error as Error).name, type: message.type },
        'ride publish failed',
      );
    }
  }
}
