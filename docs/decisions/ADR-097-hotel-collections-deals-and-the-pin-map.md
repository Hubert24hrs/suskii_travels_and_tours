# ADR-097: Hotel collections, deals, the pin map and recent searches

- Status: Accepted
- Date: 2026-11-10
- Deciders: the owner (asked for location-based discovery, an interactive map, hotel
  recommendations and deals, and the advanced lines in `docs/audits/feature-parity.md`), Claude
  Code (implementer)

## Context

Hotel results were one list in one order. Nothing showed where a hotel was, nothing helped a
family, a couple or a long stay find its kind of place, a cheap hotel looked like any other, the
hotel page said nothing about what to do nearby, and a returning visitor started every search
again. This record covers part 5 of `docs/phases/feature-parity.md`.

## Decision

### Collections and deals are fixed rules, in the open

`hotelCollections()` and `dealPercent()` (`@suskii/shared`) read only what the supplier says
about a property and the prices of the search it is in. No model ranks or labels a hotel, and a
client never computes either.

| Collection | Rule                                                                          |
| ---------- | ----------------------------------------------------------------------------- |
| Deals      | At least 15% below the median cheapest price of its star class in this search |
| Family     | A room that sleeps three or more, or a room the hotel calls a family room     |
| Luxury     | Five stars, or four stars with a guest score of 9 or more                     |
| Honeymoon  | Four or five stars, a guest score of 8 or more, and a spa or a pool           |
| Long stays | An apartment or a villa, or a kitchen, kitchenette or laundry among amenities |

- **A deal needs something to compare with.** A star class with fewer than five hotels in the
  search has no usual price, so none of its hotels is a deal. A hotel guests rate under 7 is
  never one, however cheap. The percentage is rounded down.
- **The rule is shown.** A chosen collection prints its rule under the chips, and a deal's badge
  reads "{percent}% below similar hotels". Nothing is called a deal on a supplier's word, and no
  "was" price is shown (we do not know one).
- **API.** `withCollections()` marks a priced search before filters and paging: each hotel
  summary gains `deal: { percentBelow } | null` and `collections`; the facet `collections` lists
  the ones this search has hotels for, with counts; the query takes `collection`. All additive.

### The map shows pins, not streets

The results have a "Map" view on the website and in the app: each hotel is a pin placed by its
coordinates, true in direction and relative distance (longitude shortened by the latitude). A
pin is a button with the hotel's name and price as its label; choosing one shows the hotel's
card under the drawing with "Open in maps".

- **No map tiles are loaded.** A tile map sends every viewer's address and viewport to a tile
  provider, needs that provider in the CSP and the records of processing, and a contract or a
  usage policy we would have to meet (OpenStreetMap's public servers do not allow a commercial
  site's traffic). The pin drawing sends nothing anywhere and ships no map library.
- **Streets and directions live in the traveller's maps app.** "Open in maps" is a plain link:
  OpenStreetMap on the website (new tab, `noopener noreferrer`), `geo:` on Android and Apple
  Maps on iPhone in the app. Only the hotel's coordinates and name go with it, on the
  traveller's press.
- **The list stays the complete alternative** (WCAG 1.1.1): everything the map shows is in the
  list. Pins are keyboard-operable, keep one size on screen (28 px) at any width, and the chosen
  one is drawn on top.
- The website's map is a lazy chunk loaded when "Map" is pressed; `view=map` lives in the URL.

### Things to do, from the activities partner

The hotel page shows "Things to do in {city}" through `PartnerOffers` with the hotel's country
and city (ADR-069, ADR-070): sealed links, the disclosure, nothing while offers are off or
empty. Restaurants are not built: no contracted supplier lists them.

### "Continue your search" stays on the device

The last three hotel searches that returned hotels (city id and name, dates, rooms) are kept in
the browser's local storage (`suskii:search:hotels:recent:v1`) or the app's preferences
(`search.hotels.recent`), and offered on the hotels page and above the app's hotel form. They
never reach the API, are checked again when read, drop out once their check-in has passed, and
have a "Clear" button; the app clears them with the account's data on sign-out and deletion.
This is the whole of "personal suggestions": the traveller's own searches, not a profile.

### Last-minute deals

The website's hotels page lists "Tonight in {city}" for the popular destinations: one night
from the visitor's own today, two adults, the Deals collection chosen. The dates come from the
browser's clock, so the links render there; the section sits under the destinations, where its
arrival moves nothing a visitor is reading (ADR-075).

## Consequences

- **API contract.** Additive only. App builds that predate the fields ignore them.
- **Deals depend on the search.** The same hotel can be a deal on one night and not on another,
  and in a city with few hotels per star class there are none. That is the honest reading of
  "below the usual price"; a wider reference (fare history per hotel) would need stored prices.
- **The pin map is not a street map.** A traveller who wants streets leaves for a maps app. A
  tile map can replace the drawing later behind the same view toggle.
- **Collections read supplier data.** A supplier that sends no room sizes, amenities or scores
  puts its hotels in fewer collections; the chips appear only for collections with hotels.
- **Recent searches are per device** and invisible to support. Nothing new is stored about a
  person on our side, so no export, deletion or retention rule changes.

## For the owner

- Whether to pay for a tile map (MapTiler, Mapbox, Google Maps Platform or a self-hosted tile
  server), which also means naming the provider in the privacy policy. Until then the pin view
  and the maps-app link stand.
- The deal threshold (15%), the smallest class (five hotels) and the lowest guest score (7): the
  constants in `packages/shared/src/hotel-collections.ts`.
- Viator access for "Things to do" in production (already on the checklist, ADR-069).
