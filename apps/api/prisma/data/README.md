# Reference data

| File            | Contents                                                                                    | Source                                                           |
| --------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `countries.csv` | ISO 3166-1 alpha-2 code, name, continent                                                    | [OurAirports](https://ourairports.com/data/), public domain      |
| `airports.csv`  | Airports with an IATA code and scheduled passenger service, plus an IANA time zone for each | OurAirports, public domain; time zones computed with `tz-lookup` |
| `SOURCE.json`   | Download URL, licence, generation time and row counts                                       | generated                                                        |

Regenerate with `pnpm --filter @suskii/api data:build`, review the diff, and commit. The seed
(`pnpm --filter @suskii/api db:seed`) loads these files; cities are derived from airport
municipalities. Airlines are not seeded: they come from the flight supplier's reference data in
phase 3 (ADR-006).
