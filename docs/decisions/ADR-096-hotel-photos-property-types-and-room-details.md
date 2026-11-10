# ADR-096: Hotel photos, property types and room details

- Status: Accepted
- Date: 2026-11-10
- Deciders: the owner (asked for hotel photographs, categories, room descriptions and the
  filters in `docs/audits/feature-parity.md`), Claude Code (implementer)

## Context

A hotel in the results was a name, stars, an area and a price. No photo reached a client, a rate
had only a room name, nothing said whether a property was a hotel or an apartment, and the app
could filter only by free cancellation while the website had price, stars, meals, amenities and
area. This record covers part 4 of `docs/phases/feature-parity.md`.

## Decision

### Content is the supplier's, and every part is optional

`SupplierHotel` gains `propertyType`, `description` and `photos`; `SupplierHotelRate` gains
`room` (description, guests it sleeps, size, beds). An adapter fills what its supplier sends in
the calls we already make and leaves the rest out. Nothing is invented for a real property.

- **Duffel Stays** sends a description, photos and each room's beds with the search result; the
  adapter maps them. It does not say what kind of place a property is, so the type is left out.
- **Hotelbeds and Expedia** send none of this in the availability calls we make; their content
  APIs are a later step, with their own caching (see "For the owner").
- **The demo supplier** has all of it, so test stacks and the test app show the feature: a type
  from the generated name, a description that says it is sample data, room details, and pictures
  **drawn by the website** (`/art/hotels/{seed}-{scene}.svg`: building, room, pool, restaurant).
  They are drawings on purpose: nobody can mistake one for a real place. The new fields come
  from their own random sequence, so no generated name, place or price moved.

### What the API hands out

- `propertyType` and `photo` (the first photo) on a result card; `description`, `photos` and
  each rate's `room` on the hotel page; `room` on a quote. All additive and nullable.
- **Descriptions are plain text.** `plainDescription()` (`@suskii/shared`) removes markup and
  entities, collapses whitespace and cuts at a sentence (1,200 characters for a property, 400
  for a room). Clients render text, never HTML.
- **Photo URLs are checked.** Only `https` URLs with a host name and no credentials
  (`isSafePhotoUrl()`), at most 12 per hotel; plus the demo supplier's drawings on our own
  website (plain http on a developer's machine).
- **A filter and a facet** for property types (`types=hotel,apartment`, any of them). A hotel
  whose supplier does not give a type is never matched by the filter and not counted in the
  facet, so the filter does not appear for a search whose suppliers send no types.

### What the clients load

- **Website.** A supplier's photograph is shown only when its host is in `IMAGE_REMOTE_HOSTS`,
  the list the image optimiser and the CSP already use (ADR-010); it goes through `next/image`,
  so the visitor's browser talks to our site, not to the supplier's image host. Our own drawings
  are loaded from this origin by path, whatever host the API named. Anything else is left out.
- **App.** A photograph loads over https straight from the supplier's image host; a drawing is
  loaded from the website the app is set to, by path.
- **Data saver** (ADR-075): no photos on cards or hotel pages, on the website and in the app.
- Card pictures are decorative (the hotel's name is beside them); gallery pictures are named
  "{hotel}: photo 2 of 4" with the supplier's caption. The website's strip scrolls with the
  keyboard.
- **The app gets the website's filters**: a sheet with price ceilings, stars, property type,
  meals, amenities and areas, applied on the API. The list stays in place while a filter loads.

## Consequences

- **API contract.** Additive only. App builds that predate the fields ignore them.
- **Search payloads grow** by a description and up to 12 photo URLs per hotel in the search
  store (Redis, 30 minutes); a result card carries one URL.
- **The app contacts supplier image hosts.** A traveller's device asks the supplier's image
  server for photographs (its address is visible to that server, as to any image host). The
  website does not, because of the optimiser. Recorded in `external-communications.md`.
- **Videos are not built**: none of the three hotel suppliers sends any.

## For the owner

- Add each supplier's photo host to `IMAGE_REMOTE_HOSTS` once it is known from a sandbox answer
  (Duffel's first), or the website shows no photographs for that supplier.
- Hotelbeds and Expedia content (photos, descriptions, property categories) needs their content
  APIs and a cache; say when those accounts exist.
