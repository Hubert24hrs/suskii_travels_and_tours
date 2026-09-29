# ADR-006: Reference data sources (airports, countries, cities, airlines)

- Status: Accepted
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

Phase 2 seeds airports, cities and airlines "from open sources such as OurAirports". Search
(phase 3) needs IATA codes, names, countries, coordinates and IANA time zones; bookings need airline
names and codes. The rules forbid inventing business facts.

## Decision

- **Countries and airports: OurAirports** (public domain), fetched from its GitHub mirror by
  `pnpm --filter @suskii/api data:build`, which keeps airports with an IATA code and scheduled
  passenger service (4,008 at the time of writing) and computes each airport's IANA time zone from
  its coordinates with `@photostructure/tz-lookup`. The output is committed to `apps/api/prisma/data`
  with a `SOURCE.json` (URL, licence, timestamp, counts), so seeding is offline and reviewable.
- **Cities** are derived from airport municipalities (one per country + municipality, located at
  its largest airport). Phase 3 can enrich them (aliases, popularity) without a new source.
- **Airlines are not seeded.** No public dataset is both current and permissively licensed
  (OpenFlights is stale and ODbL; Wikidata is unreachable from this environment and needs heavy
  cleaning). The `airlines` table has a `source` column and is filled in phase 3 from the flight
  supplier's reference data (for example Duffel's airlines endpoint), which is also what bookings
  will show.
- The seed is idempotent and runs on every deploy: reference data is upserted; trust signals, CMS
  blocks and FAQs are created once and never overwritten, so admin edits and verification
  decisions survive.

## Consequences

- Airport and time-zone data can be refreshed with one command and a reviewed diff.
- Until phase 3, the API cannot name airlines; nothing in phase 2 needs it.
- OurAirports' municipality names are sometimes local spellings; phase 3 autocomplete adds aliases.
