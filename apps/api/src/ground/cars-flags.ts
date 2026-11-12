import {
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  NIGERIA_BOUNDS,
  WEST_AFRICA_BOUNDS,
  type CarsProduct,
  type GeoBounds,
} from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';

/** Cars products and the flagged features built on them (ADR-049, task P9). */
export type CarsFeature =
  CarsProduct | 'bundles' | 'price_breakdown' | 'safety_suite' | 'offline_qr' | 'departure_planner';

const FLAG_KEYS = {
  buses: 'CARS_BUSES_ENABLED',
  rides: 'CARS_RIDES_ENABLED',
  rentals: 'CARS_RENTALS_ENABLED',
  bundles: 'CARS_BUNDLES_ENABLED',
  price_breakdown: 'CARS_PRICE_BREAKDOWN_ENABLED',
  safety_suite: 'CARS_SAFETY_SUITE_ENABLED',
  offline_qr: 'CARS_OFFLINE_QR_ENABLED',
  departure_planner: 'CARS_DEPARTURE_PLANNER_ENABLED',
} as const satisfies Record<CarsFeature, keyof AppConfig>;

export const CARS_FEATURES = Object.keys(FLAG_KEYS) as CarsFeature[];

/** On when set to true; unset means on outside production and off in production. */
export function carsFeatureEnabled(config: AppConfig, feature: CarsFeature): boolean {
  return config[FLAG_KEYS[feature]] ?? config.NODE_ENV !== 'production';
}

@Injectable()
export class CarsFlags {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  enabled(feature: CarsFeature): boolean {
    return carsFeatureEnabled(this.config, feature);
  }

  /** Throws 404 when the feature is off, as if its routes did not exist. */
  require(feature: CarsFeature): void {
    if (!this.enabled(feature)) throw new NotFoundException();
  }

  /** Where Cars operates: Nigeria, or West Africa with `CARS_WEST_AFRICA_ENABLED` (ADR-053). */
  get serviceArea(): GeoBounds {
    return this.config.CARS_WEST_AFRICA_ENABLED ? WEST_AFRICA_BOUNDS : NIGERIA_BOUNDS;
  }
}

export const CARS_FEATURE = 'suskii:cars-feature';

/** Routes of a Cars product or feature: 404 while it is switched off (before authentication). */
export const CarsFeatureRoute = (feature: CarsFeature): ClassDecorator & MethodDecorator =>
  SetMetadata(CARS_FEATURE, feature);

/**
 * Global guard, registered before authentication so a disabled product answers 404 to everyone
 * instead of revealing its routes with a 401.
 */
@Injectable()
export class CarsFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: CarsFlags,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<CarsFeature | undefined>(CARS_FEATURE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (feature) this.flags.require(feature);
    return true;
  }
}
