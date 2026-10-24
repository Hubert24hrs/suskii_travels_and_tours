# ADR-053: Cars geo storage and routing

- Status: Accepted
- Date: 2026-10-24
- Deciders: Claude Code (implementer), pending owner review
- Spec name: ADR-cars-geo-storage (PostGIS or equivalent)

## Context

Ride matching needs "online drivers within R metres of the pickup, nearest first", quickly and
under load. Route-deviation alerts need the distance from a driver's position to the planned
route. Terminals, stops, pickup points and rental locations need coordinates.

The task names PostGIS "or equivalent". The local database, the Docker Compose service, the CI
service containers and Testcontainers all use the official `postgres:16-alpine` image, which
does not ship PostGIS. Switching every environment to a PostGIS image means a larger image,
another image to pin and scan, and an extension the managed database must also offer (phase 12
cloud choice is still open). The contrib extensions `cube` and `earthdistance` ship with every
PostgreSQL build, including the alpine image and every managed offering.

## Decisions

1. **Coordinates are `double precision` latitude and longitude columns**, validated at the
   boundary:
   - inside Nigeria's bounding box by default;
   - inside West Africa when `CARS_WEST_AFRICA_ENABLED` is set.

   Coordinates are measurements, not money, so floating point is correct here.

2. **Proximity uses `earthdistance` on `cube`.**
   - Indexed columns get a GiST expression index on `ll_to_earth(lat, lng)`.
   - A radius search is `earth_box(ll_to_earth(:lat, :lng), :r) @> ll_to_earth(lat, lng)`,
     which uses the index, refined with `earth_distance(...) <= :r` and ordered by distance.
   - The migration enables the extensions with `CREATE EXTENSION IF NOT EXISTS`.
3. **Matching queries only fresh drivers**: online, approved, `last_location_at` within 60
   seconds, not on a trip, in the right category. Driver positions live in `drivers.last_lat`
   and `last_lng` with the GiST index. Pings go to `ride_location_pings` for the ride's own
   history.
4. **Routes and deviation.**
   - The maps provider returns a polyline with the distance and duration.
   - The polyline is stored on the ride, encoded, in the quote breakdown.
   - Deviation is computed in application code: the distance from a point to the nearest
     segment on a local equirectangular projection, which is accurate to well under a metre at
     city scale. It triggers when more than `RIDE_DEVIATION_METRES` (500) for longer than 2
     minutes.
5. **Maps provider adapters.**
   - `MapsProvider` has `route(from, to)` and `geocode(query)`. Implementations are `mock`
     (straight-line distance at 25 km/h city speed, deterministic, for tests and development)
     and `osrm` (an HTTP adapter for a self-hosted OSRM).
   - Google and Mapbox stay owner decisions (decision gate: cost and key ownership).
   - Geocoding results are cached in Redis for 24 hours, keyed by an HMAC of the normalised
     query, so addresses do not sit in Redis in clear.
6. **Degradation.** If routing fails, quotes fall back to the straight-line estimate × 1.4.
   They are labelled `estimate: "straight_line"` and capped at `RIDE_FALLBACK_MAX_KM`, so a
   provider outage cannot produce absurd fares.
7. **Retention.**
   - Location pings are kept 90 days and then deleted by the retention sweep (ADR-039).
   - A driver's last position is kept only while they are online; it is cleared when they go
     offline.

## Consequences

- No image changes in any environment. If PostGIS becomes available in production, `geography`
  columns can be added later without changing the API.
- `earthdistance` assumes a spherical earth (about 0.5% error), which is irrelevant for matching
  radii of a few kilometres.
- Distance to a polyline is computed per ping in application code. That is cheap at one ping
  per 5 seconds per active ride.
