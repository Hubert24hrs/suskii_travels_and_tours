# Feature audit: flights, hotels and car rental

Audited on 2026-11-09 against the owner's three feature lists (20 essential features and the
advanced ones for each product). Each line was checked in the API, the website and the app.
Statuses are updated as the parts of the build plan land (part 1, flights, on 2026-11-09; parts 2
to 6, seat selection, live flight status, hotel content, hotel discovery and car rental options,
on 2026-11-10).

- **Built**: works today on the API, the website and the app.
- **Partly**: some of it works; the note says what is missing.
- **Missing**: nothing in the code does it.

The build plan for every line that is not Built is in `docs/phases/feature-parity.md`.

## A. Flights

### Essential

| #   | Feature                                   | Status | Evidence, or what is missing                                                                                                                     |
| --- | ----------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | One-way flights                           | Built  | `TRIP_TYPES` in `packages/shared/src/search-limits.ts`; both search forms                                                                        |
| 2   | Round-trip flights                        | Built  | Same                                                                                                                                             |
| 3   | Multi-city flights                        | Built  | 2 to 5 legs (`MAX_FLIGHT_SLICES`)                                                                                                                |
| 4   | Domestic and international flights        | Built  | Any airport pair. Nigerian domestic airlines that are not on Duffel need IATA accreditation or a consolidator (owner)                            |
| 5   | Airline comparison                        | Built  | The `airlines` facet lists each airline with its count and lowest fare; results filter by airline                                                |
| 6   | Economy, premium economy, business, first | Built  | `CABIN_CLASSES`                                                                                                                                  |
| 7   | Adults, children and infants              | Built  | `TravellerCounts`, the passenger picker                                                                                                          |
| 8   | Departure and arrival airport selection   | Built  | Place search (`CatalogService.suggest`): airports and "all airports" of a city                                                                   |
| 9   | Flexible travel dates                     | Built  | "Flexible dates" shows the lowest total on each of the 3 days either side and searches the day chosen (ADR-093)                                  |
| 10  | Cheapest-flight search                    | Built  | `sort=cheapest`                                                                                                                                  |
| 11  | Fastest-flight search                     | Built  | `sort=fastest`                                                                                                                                   |
| 12  | Direct and connecting flight filters      | Built  | `stops` filter and "direct only" on the form                                                                                                     |
| 13  | Baggage allowance information             | Built  | Carry-on and checked bags per adult on every fare; paid extra bags (ADR-063)                                                                     |
| 14  | Airline policies and fare conditions      | Built  | Refundable, changeable and the penalties on every fare. The airline's full rules text is a legal text the owner supplies                         |
| 15  | Seat selection where supported            | Partly | Seat maps and a picker at checkout where the airline sells seats (ADR-094). The mock airline does; Duffel waits for a sandbox run (owner)        |
| 16  | Meal preferences where supported          | Partly | Seven special meals per traveller where the fare takes a request (ADR-093). The mock airline does; Duffel fares wait for a sandbox check (owner) |
| 17  | Flight price tracking                     | Built  | Price alerts (`apps/api/src/alerts`), "Watch this route" on results                                                                              |
| 18  | Flight price-drop notifications           | Built  | The alert sweep notifies on a drop of 5% or more (ADR-032)                                                                                       |
| 19  | Flight booking confirmation               | Built  | Confirmation page, email and push                                                                                                                |
| 20  | Electronic ticket and itinerary download  | Built  | `apps/api/src/documents/booking-pdf.ts` (ticket numbers per passenger)                                                                           |

### Advanced

| Feature                                     | Status | Evidence, or what is missing                                                                                                                                                                             |
| ------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI flight recommendations                   | Partly | AI trip search fills the form from a sentence (ADR-061); the "Best" order is a fixed rule, not a model                                                                                                   |
| Cheapest travel date suggestions            | Built  | The flexible-dates strip marks the cheapest day near the chosen date (ADR-093); route pages name the cheapest month (ADR-080)                                                                            |
| Nearby airport suggestions                  | Built  | Airports within 150 km of each end, as the same search from or to them (ADR-093)                                                                                                                         |
| Fare comparison and historical price trends | Partly | Route pages show the lowest fare in 30 days and the typical fare over 90; results do not compare with them                                                                                               |
| Automatic flight status tracking            | Partly | Ticketed flights are checked for airline changes (ADR-065) and followed live from a day before they leave (ADR-095); live data waits for the owner's flight-data provider (the mock runs on test stacks) |
| Flight delay and cancellation alerts        | Partly | Schedule changes alert the traveller (ADR-065, ADR-073); day-of delays, gate changes and cancellations alert by email and push (ADR-095) once a flight-data provider is set                              |
| Alternative flights when disruptions occur  | Partly | A significant change links to the other flights on the route beside the refund offer (ADR-093); rebooking in one step is not built                                                                       |
| Corporate flight booking                    | Built  | Company accounts, travel policy, approvals, reports and the company wallet (ADR-078, ADR-090)                                                                                                            |
| Group flight reservations                   | Built  | Requests for 10 to 500 travellers go to the support team as their own topic (ADR-093); airlines price groups by hand                                                                                     |

## B. Hotels

### Essential

| #   | Feature                                 | Status | Evidence, or what is missing                                                                                                                                 |
| --- | --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Search by city, country and destination | Built  | Place search matches city and country names; the search itself runs on a city                                                                                |
| 2   | Check-in and check-out dates            | Built  |                                                                                                                                                              |
| 3   | Number of guests and rooms              | Built  | Up to 8 rooms, children with ages                                                                                                                            |
| 4   | Hotel categories and star ratings       | Built  | Stars, and the property type (hotel, apartment, resort...) with a filter where the supplier gives it (ADR-096)                                               |
| 5   | Budget-based filtering                  | Built  | Maximum price on the website and in the app's filter sheet (ADR-096)                                                                                         |
| 6   | Location-based hotel discovery          | Built  | Area filter, and a map view of the results with each hotel placed by its coordinates (ADR-097)                                                               |
| 7   | Interactive hotel maps                  | Partly | Pins that can be chosen, the hotel under them and "Open in maps" for streets and directions; no street tiles until the owner picks a tile provider (ADR-097) |
| 8   | Hotel photographs and videos            | Partly | Photos on cards and a gallery on the hotel page where the supplier sends them (Duffel Stays; drawn samples on demo data) (ADR-096). No supplier sends videos |
| 9   | Room types and availability             | Built  | Every rate names its room; sold-out rates are refused at the price check                                                                                     |
| 10  | Room descriptions                       | Built  | A description, the guests it sleeps, size and beds on each rate where the supplier sends them (ADR-096)                                                      |
| 11  | Hotel amenities                         | Built  |                                                                                                                                                              |
| 12  | Breakfast availability                  | Built  | Board filter on the website and in the app (ADR-096)                                                                                                         |
| 13  | Pool, gym, Wi-Fi and parking filters    | Built  | Amenity filters on the website and in the app (ADR-096)                                                                                                      |
| 14  | Guest reviews and ratings               | Built  | The supplier's score and Suskii's verified reviews (ADR-077)                                                                                                 |
| 15  | Cancellation policies                   | Built  | Refundable or not, and the free-cancellation deadline, on every rate                                                                                         |
| 16  | Payment options                         | Built  | Payment methods at checkout (ADR-074)                                                                                                                        |
| 17  | Hotel reservation confirmation          | Built  |                                                                                                                                                              |
| 18  | Booking history                         | Built  | Trips on the website and in the app                                                                                                                          |
| 19  | Hotel recommendations                   | Built  | The "Recommended" order, collections by stated rules (family, luxury, honeymoon, long stays) and the traveller's own recent searches (ADR-097)               |
| 20  | Special hotel deals                     | Built  | A "Deals" collection and badge: at least 15% below the usual price of the star class in the search (ADR-097)                                                 |

### Advanced

| Feature                                 | Status  | Evidence, or what is missing                                                                                                             |
| --------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| AI-powered hotel recommendations        | Missing | By decision: collections and the order are fixed, stated rules; no model ranks hotels (ADR-097). AI trip search covers flights only      |
| Personalised accommodation suggestions  | Partly  | "Continue your search" offers the traveller's last hotel searches, kept on the device only; no profile is built (ADR-097)                |
| Nearby attractions and restaurants      | Partly  | "Things to do in {city}" on the hotel page from the activities partner (ADR-097); no supplier lists restaurants                          |
| Family-friendly accommodation discovery | Built   | The "Family" collection: a room for three or more, or a family room (ADR-097)                                                            |
| Honeymoon and luxury hotel collections  | Built   | "Luxury" and "Honeymoon" collections with their rules shown (ADR-097)                                                                    |
| Last-minute hotel deals                 | Built   | "Tonight in {city}" on the website's hotels page opens tonight's Deals; the Deals collection works on any dates in the app too (ADR-097) |
| Extended-stay accommodation             | Built   | The "Long stays" collection (apartments, villas, a kitchen or laundry); stays up to 30 nights (ADR-097)                                  |
| Corporate accommodation reservations    | Built   | Company accounts cover hotels                                                                                                            |
| Verified hotel and property partners    | Partly  | Hotels come only from contracted suppliers (Duffel, Hotelbeds, Expedia); sample data is badged                                           |

## C. Car rental

In production the own fleet stays off until the owner turns it on (ADR-069); until then travellers
compare rental companies through the partner offers on the Cars page. The lines below are about
the own-fleet rental system.

### Essential

| #   | Feature                                  | Status | Evidence, or what is missing                                                                                                   |
| --- | ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Search by pickup location                | Built  | By city                                                                                                                        |
| 2   | Pickup and return dates                  | Built  |                                                                                                                                |
| 3   | Pickup and drop-off times                | Built  | Branch local date and time                                                                                                     |
| 4   | Airport car rentals                      | Built  | A branch names its airport; the search has "Airport branches only" and cards say "At LOS airport" (ADR-098)                    |
| 5   | City-based car rentals                   | Built  |                                                                                                                                |
| 6   | Compare rental companies                 | Partly | Partner offers (DiscoverCars, Localrent, Economybookings) on the Cars page, not in search                                      |
| 7   | Economy vehicles                         | Built  | `RentalCategory`                                                                                                               |
| 8   | SUVs                                     | Built  |                                                                                                                                |
| 9   | Luxury vehicles                          | Built  |                                                                                                                                |
| 10  | Vans and family vehicles                 | Built  | `van`, and the seat count on every car                                                                                         |
| 11  | Automatic and manual transmission filter | Built  | A transmission filter on the website and in the app (ADR-098)                                                                  |
| 12  | Vehicle photographs                      | Built  | `photoUrls`                                                                                                                    |
| 13  | Daily, weekly and monthly rental rates   | Built  | A weekly and a thirty-day rate per car; days are priced in months, weeks and days, never above the next longer block (ADR-098) |
| 14  | Mileage allowance                        | Built  | Kilometres per day and the excess charge                                                                                       |
| 15  | Fuel policies                            | Built  |                                                                                                                                |
| 16  | Insurance information                    | Built  | `insuranceSummary`                                                                                                             |
| 17  | Driver age requirements                  | Built  | A minimum age per car, shown, filtered on and refused at the quote; the licence review stays the real check (ADR-098)          |
| 18  | Security deposit information             | Built  | Shown before booking; held and released through the ledger (ADR-051)                                                           |
| 19  | Driver's licence requirements            | Built  | Licence upload and review before a self-drive pickup                                                                           |
| 20  | Rental booking confirmation              | Built  |                                                                                                                                |

### Advanced

| Feature                                     | Status | Evidence, or what is missing                                                                                                   |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Chauffeur-driven vehicle rentals            | Built  | `chauffeurDaily`, a vetted driver assigned at pickup                                                                           |
| Self-drive rentals                          | Built  |                                                                                                                                |
| Airport pickup and drop-off                 | Built  | Airport branches for pickup, and a return to an airport branch where the car allows it; delivery to an address stays (ADR-098) |
| Cross-border rental options where permitted | Built  | The countries a car may enter and a flat fee, chosen at booking; the desk hands over the papers (ADR-098)                      |
| Vehicle delivery to customers               | Built  | Per kilometre, within the branch's radius                                                                                      |
| Corporate fleet rentals                     | Partly | Company bookings and approvals cover rentals; no fleet or contract rates                                                       |
| Long-term rentals                           | Built  | Up to 90 days at the weekly and monthly rates (ADR-098)                                                                        |
| Premium vehicle categories                  | Built  | `luxury`                                                                                                                       |
| Multiple pickup and return locations        | Built  | A return to another branch for its one-way fee, where the car allows it (ADR-098)                                              |
| Additional driver options                   | Built  | An extra per day, not with a chauffeur (ADR-098)                                                                               |
| Child seats and GPS add-ons                 | Built  | Extras per day and per unit, priced again before payment (ADR-098)                                                             |

## Totals

|            | Built | Partly | Missing | Lines |
| ---------- | ----- | ------ | ------- | ----- |
| Flights    | 22    | 7      | 0       | 29    |
| Hotels     | 23    | 5      | 1       | 29    |
| Car rental | 29    | 2      | 0       | 31    |
| All        | 74    | 14     | 1       | 89    |
