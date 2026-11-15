import { Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { GooglePlacesProvider } from './google-places';
import { LocationService, PLACES } from './location.service';
import { MockPlacesProvider, type PlacesProvider } from './places';

/** The places provider the settings name, or null while places are off (ADR-122). */
export function placesProviderFor(config: AppConfig): PlacesProvider | null {
  if (config.PLACES_PROVIDER === 'google' && config.GOOGLE_MAPS_SERVER_KEY) {
    return new GooglePlacesProvider({
      baseUrl: config.GOOGLE_PLACES_API_URL,
      apiKey: config.GOOGLE_MAPS_SERVER_KEY,
      timeoutMs: config.MAPS_TIMEOUT_MS,
    });
  }
  return config.PLACES_PROVIDER === 'mock' ? new MockPlacesProvider() : null;
}

/**
 * Places and distances for Ask Suskii (ADR-122). Routing comes from the Cars module's
 * `MapsProvider` (global), so rides, rental delivery and the assistant share one provider.
 */
@Module({
  providers: [
    { provide: PLACES, inject: [APP_CONFIG], useFactory: placesProviderFor },
    LocationService,
  ],
  exports: [LocationService, PLACES],
})
export class LocationModule {}
