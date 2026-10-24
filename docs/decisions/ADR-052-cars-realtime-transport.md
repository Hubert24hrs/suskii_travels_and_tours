# ADR-052: Cars realtime transport

- Status: Accepted
- Date: 2026-10-24
- Deciders: Claude Code (implementer), pending owner review
- Spec name: ADR-cars-realtime-transport

## Context

Riders need the driver's location, the trip status and the ETA as they change. Drivers need ride
offers with a 15-second accept window. The API runs as several replicas behind a load balancer.
The task asks for a NestJS WebSocket gateway with Redis pub/sub.

Supply-chain guards (ADR-041) mean a new dependency waits out the release cooldown and must keep
its provenance. `ws` is already in the lockfile, pulled in by existing packages. NestJS's
`@nestjs/websockets` and `@nestjs/platform-ws` are not, and add a second decorator-driven
lifecycle to maintain.

## Decisions

1. **Plain `ws` on the API's HTTP server at `/v1/ws/rides`.** A small `RideRealtimeGateway` in
   the rides module handles the upgrade, authentication and subscriptions. It is attached in
   `main.ts` and in the e2e test app, so the transport uses the same port, TLS and load balancer
   as the REST API. Sticky sessions are not required.
2. **Authentication.**
   - Browsers authenticate with the session cookie. The upgrade request's `Origin` must be in
     `CORS_ORIGINS`, which stops cross-site WebSocket hijacking.
   - The app and other bearer clients send `{"type":"auth","token":"<access token>"}` as their
     first message within 5 seconds, or the socket closes with code 4401.
   - Tokens never travel in the URL. A revoked session (Redis denylist) closes the socket on its
     next message and at the periodic recheck.
3. **Subscriptions are authorised per ride.**
   - A client sends `{"type":"subscribe","rideId":...}`. The gateway checks that the caller is
     the ride's rider, or the driver it is assigned to or currently offered to.
   - Anything else answers `{"type":"error","code":"not_found"}`, the same as for a missing
     ride. The REST API answers 404 for other people's resources in the same way.
   - Drivers also get their own `driver:{driverId}` channel for offers.
4. **Fan-out through Redis pub/sub.** State changes and location pings publish to
   `rides:{rideId}` (and `driver:{driverId}` for offers), after the database change commits.
   - Each replica subscribes to the channels its connected clients follow, and drops them when
     the last follower leaves.
   - Messages carry ids, state, ETA and a rounded driver position: no personal data beyond what
     the ride screen shows.
5. **Limits.**
   - Connections per user are capped at 5, and messages per socket at 20 a second.
   - Idle sockets get a ping every 25 seconds; one that misses two closes.
   - Payloads over 4 KB close the socket.
6. **Polling stays the fallback.** `GET /v1/rides/:id` returns the same state, so clients that
   cannot hold a socket (some networks block upgrades) poll every 5 seconds. Delivery is
   best-effort; the database is the record.
7. **Location ingestion stays REST** (`POST /v1/drivers/me/location`): one request every 5
   seconds at most, plausibility-checked, then published. A REST endpoint keeps rate limiting,
   idempotency and attestation on the paths that already have them.

## Consequences

- No new runtime dependency beyond promoting `ws` to a direct dependency of the API.
- Each replica holds one Redis subscriber connection for pub/sub, besides its command
  connection.
- A message published while a client is reconnecting is lost. Clients re-read the ride over
  REST after every reconnect.
