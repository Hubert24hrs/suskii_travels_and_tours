# ADR-122: Google Maps Platform for Ask Suskii's places and distances, behind our own providers

- Status: Accepted (part 1 of `docs/phases/google-maps.md`; the maps on the website and in the
  app follow in their own parts)
- Date: 2026-11-15
- Deciders: the owner (asked for Google Maps Platform across the platform and the assistant),
  Claude Code (implementer)
- Amends: ADR-053 (routing behind `MapsProvider`), ADR-097 (the tile provider left to the owner)

## Context

The owner asked for Google Maps Platform in the app, the website and the AI agent:

- interactive maps of hotels, airports and rental branches;
- what is nearby (airports, restaurants, attractions, shopping);
- distances and travel times;
- hotels compared by how close they are to a place;
- recommendations by location from Ask Suskii.

The owner's constraints:

- keep the backend;
- no secret in a client;
- restricted keys behind backend proxies;
- no fabricated distances or availability;
- nothing deployed and nothing billed without their approval;
- nothing that works today may break.

The platform already held most of what this needs. Hotels, airports, cities and rental branches have coordinates. Airports nearby are an SQL distance over our own catalog (ADR-093). Routing for rides and rental delivery sits behind `MapsProvider`, with a mock and OSRM (ADR-053). Ask Suskii's tools reach the platform only through the gateway, with references the platform issued (ADR-101).

Google's terms shape the design:

- Place ids may be kept indefinitely, and coordinates for up to 30 days. Other Places content (names, addresses, ratings) and routes may not be cached or stored beyond that.
- Places content shown without a Google map carries the "Google Maps" attribution.
- Places content may not be shown on a map that is not Google's.

## Decision

1. **Two providers, as for every outside service.**
   - `PlacesProvider` (`src/location/places.ts`) has the adapters `mock` and `google`. `google` is the Places API (New): Nearby Search and Text Search, with a field mask of name, short address, point, type, rating, rating count and price level. `PLACES_PROVIDER=none` (the default) switches places off.
   - Routing stays `MapsProvider`. It gains a `google` adapter for the Routes API: `computeRoutes`, and `computeRouteMatrix` behind a new `matrix()`. It is traffic-unaware, the cheapest tier, which gives the same answer at any hour. Other providers answer `matrix()` with one `route()` per pair.
   - The server key goes in the `X-Goog-Api-Key` header, never in a URL. It comes only from `GOOGLE_MAPS_SERVER_KEY`, a secret restricted to those two APIs and the API's addresses.
   - Production refuses the mock places provider unless `ALLOW_MOCK_PROVIDERS`, and refuses plain http to either API.
2. **One service decides every call** (`LocationService`). It counts a daily cap per Google API in Redis before the call:
   - `GOOGLE_PLACES_DAILY_CALLS`, 300 a day by default;
   - `GOOGLE_ROUTES_DAILY_ELEMENTS`, 2,000 a day by default, where an element is one origin and destination pair.

   The cap fails closed when Redis cannot count. A circuit breaker opens after repeated failures, and every call has a timeout. Search text is scrubbed of contact details and numbers first.

   Nothing from Google is cached: every name, rating and route a traveller reads comes from a call made for that answer.

3. **No made-up figure reaches a traveller.**
   - **Routing:** a distance is by road through a real router, or the straight line, labelled as such, with no time. The mock router answers only where mocks are allowed, and its figures are marked `sample`.
   - **Hotel positions:** a hotel whose supplier gave no position (the adapters then put it at the city's point, or at 0,0) is measured from nowhere; it is listed as `position_unknown`.
   - **Airports:** airports nearby come from our own catalog, free and exact.
4. **Four read tools for Ask Suskii** (`src/agent/tools/location-tools.ts`):
   - `places.find`: a public place by name;
   - `places.nearby`: restaurants, attractions or shopping around a hotel, an airport or a found place;
   - `places.compare_proximity`: hotels of a search against an airport or a place, nearest first;
   - `places.airports_near`: the nearest airports to a hotel or a place.

   How the tools take and give figures:
   - **What a tool measures from:** a reference the platform already holds, never coordinates a model could invent or mistype. That is a hotel's `rateId` from `hotels.search`, an airport code, or a place reference (`place_1`) that this conversation's tools issued.
   - **Where references live:** `AgentPlaceRefs` holds a place's provider id and point in Redis for six hours, as Google allows. It keeps no names.
   - **Figures:** distances and times come as text (`distanceText`, `durationText`), so the guard's figure check holds a model to them.
   - **Notes:** three notes go with the answers, whatever the model wrote. `places_google` is Google's attribution, `distance_straight` marks a straight-line distance and `driving_estimate` marks a time without traffic.

   The tools go to the concierge, hotels and trip builder agents, whose prompts change version. Each of the three evals gains cases.

5. **No public route asks Google.** A hotel page that listed nearby places would cost a Places call for every page view. Instead the website's and the app's Google maps (parts 2 and 3) will show Google's own points of interest, which cost nothing beyond the map. Airports come from our catalog.
6. **The testing machine** gets one setting, `LOCATION_PROVIDER`:
   - `mock`, the default: sample places and figures that say they are samples;
   - `google`: Google's places and routes, with the owner's key from Secret Manager and caps of 200 calls and 1,000 elements a day.

   Terraform enables the two APIs only with `google`.

## Consequences

- **Cost:** nothing calls Google, and nothing is billed, until the owner creates a restricted server key, stores it and chooses `google`. The caps bound a busy day: at most the day's calls, and then the tools say places are unavailable and distances fall back to the straight line.
- **Rides and rental delivery:** they route through Google too when `MAPS_PROVIDER=google`, without the assistant's cap; those are priced services the owner chooses to switch on.
- **What Google receives:** coordinates and, for a search by name, the scrubbed name of a public place. It never receives a traveller, a booking or an account, and never the traveller's device address, since the API calls Google itself.
  - Google Maps Platform is listed as an optional processor in the records of processing.
  - Residency is a question for counsel: the Maps Platform has no regional endpoint.
- **Cost of the safeguards:** with no caching, a repeated question costs a repeated call. The caps, the tools' small limits and the run's tool-call limit keep that small.
- **The clients need no new code for part 1:** answers and notes render as they do today. The notes are worded in every catalog and on WhatsApp.

## Alternatives considered

- **Caching Places answers for a day:** cheaper, but outside Google's terms for anything but ids and coordinates.
- **Letting the model pass coordinates:** simpler tools, but a model could invent or mistype a location, and the guard cannot tell a copied coordinate from a made-up one.
- **A public nearby-places route for hotel pages:** useful, but billed per page view. The map's own points of interest show the same without the bill. It can be added behind a setting if the owner wants a list.
- **Mapbox or OpenStreetMap tiles with Google places:** Google's terms forbid showing Places content on another map.
