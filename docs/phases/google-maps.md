# Google Maps Platform: maps, places, routes and Ask Suskii's location tools (plan)

Outside the numbered phases. The owner asked on 2026-11-15 for Google Maps Platform across the
app, the website and Ask Suskii:

- interactive maps with hotels, airports and rental branches, and map-based hotel discovery;
- nearby airports, restaurants, attractions and shopping;
- distances and travel times;
- proximity comparisons between hotels;
- location-based recommendations through the LangGraph agent.

The constraints:

- no secret in a client;
- restricted keys and backend proxies;
- nothing deployed and no paid call without the owner's approval;
- no fabricated distance or availability;
- nothing that works today may break.

This plan is step one and two of the owner's execution order (audit, then requirements). Each
part below ends with tests and a report, and the decision record is ADR-122, written with part 1.

## What already exists (audit, 2026-11-15)

- **The backend is not Firebase.** It is the NestJS API with PostgreSQL and Redis on Google
  Cloud (ADR-110, ADR-111). Firebase appears only as the planned sender of Android push
  notifications through Expo (ADR-022). "Keep the backend" therefore means this API.
- **Maps today.** The hotel results' map view draws pins from coordinates, with no tiles and no map
  library (ADR-097):
  - website: `components/results/hotel-map.tsx`, a lazy chunk behind `view=map`;
  - app: `components/results/hotel-map.tsx` with `react-native-svg`.
  - "Open in maps" goes to OpenStreetMap on the website and to the phone's maps app in the app
    (`lib/maps.ts`). ADR-097 left the tile provider to the owner: Google answers it.
- **Coordinates already held.**
  - Hotels have `latitude`/`longitude` in search answers. Without a supplier position the adapters
    fall back to the city's coordinates, then 0.
  - Airports have them (OurAirports, non-null). Cities have them, nullable, taken from their main
    airport.
  - Rental branches have them, with return branches (`RentalVehicle`).
  - Bus terminals have them in the database; the public answer gives only name and address.
  - Ride places have them (public), and reviews' hotel subjects.
- **Distances and routes.**
  - `CatalogService.nearbyAirports` finds airports near an airport by the haversine distance in
    SQL (ADR-093).
  - The Cars `MapsProvider` (`src/ground/maps.ts`, adapters `mock` and `osrm`, `MAPS_PROVIDER`)
    routes rides, rental delivery and the departure planner. It falls back to a straight-line
    estimate.
- **The assistant.**
  - Tools are `AgentTool`s registered with the gateway. A card links only to a path of our own
    site, and no tool returns coordinates yet.
  - Prompt versions: concierge@4, flights@5, hotels@4, cars@4, trip_builder@5, router@1.
  - Evals: routing (98 cases), grounding (33), safety (44) and `places.json`.
- **Guards that matter here.**
  - The website's CSP is nonce based with `strict-dynamic`, and payment pages allow only our
    scripts.
  - Homepage JavaScript is capped at 170 kB.
  - The app bundle scan and gitleaks flag Google API keys (`AIza…`).
  - The website sends `Permissions-Policy: geolocation=()`.
  - pnpm's trust policy has already blocked `expo-location`.

## What the integration adds

### Part 1: location services in the API and Ask Suskii's location tools

- **Providers behind abstract classes**, as every outside service is. Vendor types stay in the
  adapters, and each has a mock for tests and a `none` that switches it off.
  - `PlacesProvider` (`PLACES_PROVIDER=none|mock|google`): nearby places by kind (restaurants,
    attractions, shopping, with a few aliases) and a place found by name. It uses Google Places
    API (New), with a field mask so only the fields we show are billed.
  - Routes reuse the existing `MapsProvider`, which gains a `google` adapter (Routes API:
    `computeRoutes` for one route, `computeRouteMatrix` for several hotels against one place).
    Rides, rental delivery and the planner then route through Google too, when chosen.
  - Geocoding (`GEOCODING_PROVIDER`): only where an address must become coordinates, namely the
    console's rental branches and bus terminals. Travellers' addresses are never geocoded.
- **A `LocationService`** decides what may be asked.
  - A daily cap per Google API is counted in Redis before each call and fails closed. Every call
    has a timeout, and a circuit breaker opens on failures.
  - Nothing from Google is cached: Google's terms allow keeping only place ids and coordinates.
    A conversation's places are kept as references (`place_1`) holding just those, for six hours.
  - What leaves the platform: coordinates of hotels, airports and places, and the name of a
    landmark a traveller asked about after `scrubQuery()`. Never a name, contact or booking.
- **Airports nearby come from our own catalogue**, free and exact: a new `airportsNear(point)`
  beside `nearbyAirports(code)`. Google is not asked.
- **No public route asks Google.** A list of nearby places on every hotel page would bill a
  Places call per page view; the Google maps of parts 2 and 3 show Google's own points of
  interest instead, and airports come from the catalogue.
- **Ask Suskii's tools** (read tier, through the gateway with the run's grant). Each takes a
  reference the platform already holds (a hotel from the conversation's search, a catalogue city,
  an airport code or a place found by name), so a model cannot invent a location:
  - `places.nearby`: what is around a hotel, a city or an airport, by kind.
  - `places.find`: a landmark or district by name, as a short-lived reference.
  - `places.compare_proximity`: hotels from the last search against a place or an airport, with
    distance and driving time as text, nearest first.
  - `places.airports_near`: the nearest airports to a hotel or a city, from the catalogue.

  Their answers carry the basis of every figure (`routed` or `straight_line`). Places from Google
  carry a note the clients put into words with Google's attribution. They go to the hotels, trip
  builder, concierge and cars agents, whose prompts change version. They get eval cases and the
  `tools.json` snapshot.

### Part 2: maps on the website (Maps JavaScript API)

- A Google map replaces the drawn pins behind the same `view=map` toggle when a browser key is
  set. Without one, today's drawing stays.
- The map shows the results' hotels, the nearest airports and the selected hotel. The hotel page
  gets a small map with what is nearby. A rental car's page shows its pickup branch and the
  branches it may be returned to.
- The map is a lazy chunk loaded only on a map view, so the homepage budget is untouched. Its
  hosts join the CSP of those pages only; payment pages never load it.
- The browser key is read at request time, like the ad tags (ADR-079).

### Part 3: maps in the app (Google Maps SDK)

- `react-native-maps` with Google's provider replaces the drawn pins when the build carries a key
  (Android, and iOS when a key is given). Without one, today's drawing stays.
- The same views as the website: hotel results, the nearest airports, rental branches.
- The keys enter the native project at build time through the library's config plugin, never the
  JavaScript bundle. The bundle scan keeps refusing `AIza…` in JavaScript. The APK scan allows
  only that key's place in the Android manifest, with the reason written beside the rule.
- The dependency is checked against the trust policy before it is added (ADR-055).

## Keys and settings

| Key or setting            | Used by                  | Restricted to                                                     | Lives in                                                   |
| ------------------------- | ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| `GOOGLE_MAPS_SERVER_KEY`  | API                      | Places API (New), Routes API, Geocoding API; the API's egress IPs | Secret Manager (`extra_secrets`, the VM's secret list)     |
| `GOOGLE_MAPS_BROWSER_KEY` | website, at request time | Maps JavaScript API; the website's own hosts as referrers         | web container environment (public by design, restricted)   |
| `GOOGLE_MAPS_ANDROID_KEY` | app build                | Maps SDK for Android; the package name and signing certificate    | GitHub secret for the test APK, EAS environment for stores |
| `GOOGLE_MAPS_IOS_KEY`     | app build                | Maps SDK for iOS; the bundle id                                   | EAS environment                                            |
| `PLACES_PROVIDER`         | API                      | `none` (default in production), `mock`, `google`                  | `api_env`                                                  |
| `MAPS_PROVIDER`           | API                      | adds `google` to `mock` and `osrm`                                | `api_env`                                                  |
| `GOOGLE_MAPS_DAILY_CAP_*` | API                      | calls a day per API before it stops asking                        | `api_env`                                                  |

The browser and app keys reach people's devices, as every Maps key does. Their restrictions are
the protection, and only the server key is a secret. No key is in the repository, and nothing is
hard-coded.

## Costs and approvals

- Nothing calls Google until the owner creates the keys and sets the providers. Tests and CI use
  the mocks; no test or workflow calls Google.
- Caching and the daily caps bound what a busy day can cost. A budget alert on the project is the
  owner's to set.
- The owner approves each switch: the server key in Secret Manager, the browser key on the
  website, the app key in its build.

## Privacy and compliance

- **Records of processing:** Google becomes a recipient.
  - Places and Routes receive coordinates and landmark names, no personal data.
  - The maps on the website and in the app receive each viewer's address and viewport, the same
    as ADR-097 said of any tile provider.
- **Other documents to update:** the outbound hosts, the privacy policy and the store forms
  (`docs/release/data-safety.md`). The cookie and storage catalogue gains whatever the Maps
  script keeps, if anything.
- **Data residency:** Google's map and places services are global, with no regional endpoint.
  This is for counsel, beside ADR-112's question about Vertex AI.

## Risks

- **Google's terms:** places content may be cached only briefly and must carry Google's
  attribution where it is shown without a Google map. Both are designed in.
- **Edge cases in coordinates:** a hotel at 0,0 (a supplier with no position) must not be pinned
  or compared; it is left out and said so.
- **The new native dependency** must pass the trust policy and the Android and iOS builds in CI.
  The phone check runs the map view on the emulator without a key (the drawn fallback).
- **Spend:** a model could ask for many places in one run. The tools' own limits, the gateway's
  call limit, the cache and the daily caps bound it.

## Order of work

1. Part 1: providers, service, routes and tools, with unit tests, e2e tests on the mocks, the
   tool snapshot and eval cases. Then docs (ADR-122, env, security, records, go-live and launch
   checklists).
2. Part 2: the website's map, with e2e tests for the fallback and the CSP, and a key-present test
   that intercepts the Maps script so nothing is billed.
3. Part 3: the app's map, with Jest tests, the Android and iOS builds in CI, and the phone check.

Each part is its own pull request, reviewed and merged as the others are.

## Outcome of part 1 (2026-11-15)

Built as planned, with three changes found on the way (ADR-122):

- **No caching of Google's content.** The terms allow only place ids and coordinates, so the
  references hold just those, and the daily caps bound the cost instead.
- **No public places route.** It would bill a call per hotel page view.
- **A setting for the testing machine.** `LOCATION_PROVIDER=mock` (sample places, the default)
  or `google`.

Tests:

- API unit tests cover the providers, the caps, the breaker, the straight-line fallback, the
  adapters' requests and answers, and the settings.
- The agent tools e2e covers the four tools on the mocks, from a hotel search to a comparison.
- The three evals pass on recorded answers with new cases for routing, grounding and safety.
- The tools snapshot (`apps/agent/evals/tools.json`) is refreshed.

Two things wait:

- One run of the evals against the model (Cloud Build) before the new prompts answer
  travellers.
- The owner's key (launch checklist 7.7).

One bug was caught by the tests before it shipped: `new URL('places:searchText', base)` reads
`places:` as a URL scheme, so both adapters build their paths as `./...`.

## What the owner provides

1. **The project:** a Google Cloud project for Maps, `suskii-travels-staging` to start, with
   billing.
2. **The APIs to enable:** Maps JavaScript API, Maps SDK for Android, Maps SDK for iOS, Places API
   (New), Routes API and Geocoding API.
3. **The four keys,** each with the restrictions above, and quotas and a budget alert on the
   project.
4. **Where they go:** the server key in Secret Manager as `GOOGLE_MAPS_SERVER_KEY`, the browser key
   in the website's settings, and the Android key as the GitHub secret `GOOGLE_MAPS_ANDROID_KEY`.
5. **The decisions:** the daily caps, the privacy policy naming Google, and counsel on residency.
