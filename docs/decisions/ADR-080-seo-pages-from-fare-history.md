# ADR-080: SEO pages from fare history

- Status: Accepted
- Date: 2026-10-28
- Deciders: Claude Code (implementer), pending owner review

## Context

Item 8 of the standards plan (growth) asks for SEO landing pages. Suskii has a page per popular
route (ADR-011) showing the latest cheap fare. Travel search results reward pages that answer the
questions people type: the usual price, the airlines, whether a direct flight exists, the journey
time and the cheapest month. The deal refresh searches every route several times a day, but kept
only the single cheapest snapshot for 7 days.

## Decision

1. **Fare history.** `route_fares` keeps, per route, observation day (UTC) and departure date,
   the cheapest fare a refresh found: supplier, carrier, stops, outbound duration and the
   supplier's base and taxes. A later refresh the same day replaces the row only when it is
   cheaper (compared in US dollars at the time). Rows are pruned after
   `ROUTE_FARE_RETENTION_DAYS` (400, so a full year of months is always available). It holds no
   personal data.
2. **Facts are priced at read time.** `RouteFactsService` reads one route's rows and prices them
   with the current `PricingService` rules, display currency and sales channel, exactly like the
   deal cards: supplier cost never leaves the API.
   - `cheapest`: the lowest fare found in the last 30 days, with its departure date.
   - `typical`: the median of each day's cheapest fare over 90 days.
   - `airlines`: carriers seen in 90 days, most frequent first (up to 6).
   - `direct`: whether a nonstop outbound was seen in 90 days; `fastestMinutes`: the shortest
     outbound journey.
   - `cheapestMonth`: the departure month with the lowest median over 365 days, only when at
     least three months were observed.
   - Facts appear only once `ROUTE_FACTS_MIN_DAYS` (3) observation days exist in 90 days, and
     carry `sample` when any fare came from the mock supplier.
3. **Hubs and airline pages.** City hubs group active routes by the city slug of their origin
   ("from") or destination ("to"); airline pages list the routes an airline was seen on in 90
   days with its own cheapest fare there. Pages without a route answer 404 and stay out of the
   sitemap. Airline names come from the airlines table (synced from Duffel), else the fare.
4. **Pages.** `/flights/from/[city]`, `/flights/to/[city]` and `/airlines/[code]` are server
   pages with metadata, canonical paths, breadcrumbs and sitemap entries. Route pages show the
   facts and link to both hubs and to each airline's page; hubs link to routes. Every figure is
   labelled with what it is (one adult, return, the route's cabin, from fares found recently).

## Consequences

- Each route page answers the common questions with numbers that change as fares change, and the
  site gains a crawlable network of hub and airline pages.
- Facts need a few days of refreshes after launch before they show; until then pages look as
  before.
- More departure offsets (`DEALS_DEPARTURE_OFFSETS_DAYS`) give richer month data at the cost of
  more supplier searches; the owner can widen them.
