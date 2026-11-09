# Feature audit: flights, hotels and car rental

Audited on 2026-11-09 against the owner's three feature lists (20 essential features and the
advanced ones for each product). Each line was checked in the API, the website and the app.

- **Built**: works today on the API, the website and the app.
- **Partly**: some of it works; the note says what is missing.
- **Missing**: nothing in the code does it.

The build plan for every line that is not Built is in `docs/phases/feature-parity.md`.

## A. Flights

### Essential

| #   | Feature                                   | Status  | Evidence, or what is missing                                                                                             |
| --- | ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | One-way flights                           | Built   | `TRIP_TYPES` in `packages/shared/src/search-limits.ts`; both search forms                                                |
| 2   | Round-trip flights                        | Built   | Same                                                                                                                     |
| 3   | Multi-city flights                        | Built   | 2 to 5 legs (`MAX_FLIGHT_SLICES`)                                                                                        |
| 4   | Domestic and international flights        | Built   | Any airport pair. Nigerian domestic airlines that are not on Duffel need IATA accreditation or a consolidator (owner)    |
| 5   | Airline comparison                        | Built   | The `airlines` facet lists each airline with its count and lowest fare; results filter by airline                        |
| 6   | Economy, premium economy, business, first | Built   | `CABIN_CLASSES`                                                                                                          |
| 7   | Adults, children and infants              | Built   | `TravellerCounts`, the passenger picker                                                                                  |
| 8   | Departure and arrival airport selection   | Built   | Place search (`CatalogService.suggest`): airports and "all airports" of a city                                           |
| 9   | Flexible travel dates                     | Partly  | The "Flexible dates (± 3 days)" box is saved in the link but the results ignore it                                       |
| 10  | Cheapest-flight search                    | Built   | `sort=cheapest`                                                                                                          |
| 11  | Fastest-flight search                     | Built   | `sort=fastest`                                                                                                           |
| 12  | Direct and connecting flight filters      | Built   | `stops` filter and "direct only" on the form                                                                             |
| 13  | Baggage allowance information             | Built   | Carry-on and checked bags per adult on every fare; paid extra bags (ADR-063)                                             |
| 14  | Airline policies and fare conditions      | Built   | Refundable, changeable and the penalties on every fare. The airline's full rules text is a legal text the owner supplies |
| 15  | Seat selection where supported            | Missing | Only buses have a seat picker                                                                                            |
| 16  | Meal preferences where supported          | Missing |                                                                                                                          |
| 17  | Flight price tracking                     | Built   | Price alerts (`apps/api/src/alerts`), "Watch this route" on results                                                      |
| 18  | Flight price-drop notifications           | Built   | The alert sweep notifies on a drop of 5% or more (ADR-032)                                                               |
| 19  | Flight booking confirmation               | Built   | Confirmation page, email and push                                                                                        |
| 20  | Electronic ticket and itinerary download  | Built   | `apps/api/src/documents/booking-pdf.ts` (ticket numbers per passenger)                                                   |

### Advanced

| Feature                                     | Status  | Evidence, or what is missing                                                                               |
| ------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| AI flight recommendations                   | Partly  | AI trip search fills the form from a sentence (ADR-061); the "Best" order is a fixed rule, not a model     |
| Cheapest travel date suggestions            | Partly  | Route pages name the cheapest month (ADR-080); nothing suggests a cheaper day near the chosen date         |
| Nearby airport suggestions                  | Missing |                                                                                                            |
| Fare comparison and historical price trends | Partly  | Route pages show the lowest fare in 30 days and the typical fare over 90; results do not compare with them |
| Automatic flight status tracking            | Partly  | Ticketed orders are checked for airline changes (ADR-065); no live status on the day of travel             |
| Flight delay and cancellation alerts        | Partly  | Cancellations and time changes alert the traveller (ADR-065, ADR-073); day-of delays do not                |
| Alternative flights when disruptions occur  | Missing | The traveller can accept the change or take the refund; nothing suggests other flights                     |
| Corporate flight booking                    | Built   | Company accounts, travel policy, approvals, reports and the company wallet (ADR-078, ADR-090)              |
| Group flight reservations                   | Missing | A booking takes at most 9 travellers; there is no group request                                            |

## B. Hotels

### Essential

| #   | Feature                                 | Status  | Evidence, or what is missing                                                  |
| --- | --------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| 1   | Search by city, country and destination | Built   | Place search matches city and country names; the search itself runs on a city |
| 2   | Check-in and check-out dates            | Built   |                                                                               |
| 3   | Number of guests and rooms              | Built   | Up to 8 rooms, children with ages                                             |
| 4   | Hotel categories and star ratings       | Partly  | Stars: yes. The property type (hotel, apartment, resort) is not kept          |
| 5   | Budget-based filtering                  | Partly  | Website: yes (`maxPrice`). The app has no price filter                        |
| 6   | Location-based hotel discovery          | Partly  | Area filter on the website; coordinates are returned but nothing shows them   |
| 7   | Interactive hotel maps                  | Missing |                                                                               |
| 8   | Hotel photographs and videos            | Missing | No supplier photo reaches the clients; cards show no picture                  |
| 9   | Room types and availability             | Built   | Every rate names its room; sold-out rates are refused at the price check      |
| 10  | Room descriptions                       | Missing | A rate has a room name only                                                   |
| 11  | Hotel amenities                         | Built   |                                                                               |
| 12  | Breakfast availability                  | Partly  | Website: board filter. The app shows the board but cannot filter              |
| 13  | Pool, gym, Wi-Fi and parking filters    | Partly  | Website: amenity filters. The app has none                                    |
| 14  | Guest reviews and ratings               | Built   | The supplier's score and Suskii's verified reviews (ADR-077)                  |
| 15  | Cancellation policies                   | Built   | Refundable or not, and the free-cancellation deadline, on every rate          |
| 16  | Payment options                         | Built   | Payment methods at checkout (ADR-074)                                         |
| 17  | Hotel reservation confirmation          | Built   |                                                                               |
| 18  | Booking history                         | Built   | Trips on the website and in the app                                           |
| 19  | Hotel recommendations                   | Partly  | The "Recommended" order and popular destinations; nothing personal            |
| 20  | Special hotel deals                     | Partly  | Popular destinations with "from" prices; no deals list for hotels             |

### Advanced

| Feature                                 | Status  | Evidence, or what is missing                                                                   |
| --------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| AI-powered hotel recommendations        | Missing | AI trip search covers flights only                                                             |
| Personalised accommodation suggestions  | Missing |                                                                                                |
| Nearby attractions and restaurants      | Partly  | Partner activities (Viator) show on a booking, not on the hotel page; no restaurants           |
| Family-friendly accommodation discovery | Missing |                                                                                                |
| Honeymoon and luxury hotel collections  | Missing |                                                                                                |
| Last-minute hotel deals                 | Missing |                                                                                                |
| Extended-stay accommodation             | Partly  | Stays up to 30 nights; nothing helps find weekly or monthly stays                              |
| Corporate accommodation reservations    | Built   | Company accounts cover hotels                                                                  |
| Verified hotel and property partners    | Partly  | Hotels come only from contracted suppliers (Duffel, Hotelbeds, Expedia); sample data is badged |

## C. Car rental

In production the own fleet stays off until the owner turns it on (ADR-069); until then travellers
compare rental companies through the partner offers on the Cars page. The lines below are about
the own-fleet rental system.

### Essential

| #   | Feature                                  | Status  | Evidence, or what is missing                                                              |
| --- | ---------------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| 1   | Search by pickup location                | Built   | By city                                                                                   |
| 2   | Pickup and return dates                  | Built   |                                                                                           |
| 3   | Pickup and drop-off times                | Built   | Branch local date and time                                                                |
| 4   | Airport car rentals                      | Missing | A branch is a name and an address; nothing marks or finds airport branches                |
| 5   | City-based car rentals                   | Built   |                                                                                           |
| 6   | Compare rental companies                 | Partly  | Partner offers (DiscoverCars, Localrent, Economybookings) on the Cars page, not in search |
| 7   | Economy vehicles                         | Built   | `RentalCategory`                                                                          |
| 8   | SUVs                                     | Built   |                                                                                           |
| 9   | Luxury vehicles                          | Built   |                                                                                           |
| 10  | Vans and family vehicles                 | Built   | `van`, and the seat count on every car                                                    |
| 11  | Automatic and manual transmission filter | Partly  | Every car shows its transmission; the search cannot filter by it                          |
| 12  | Vehicle photographs                      | Built   | `photoUrls`                                                                               |
| 13  | Daily, weekly and monthly rental rates   | Partly  | Daily only                                                                                |
| 14  | Mileage allowance                        | Built   | Kilometres per day and the excess charge                                                  |
| 15  | Fuel policies                            | Built   |                                                                                           |
| 16  | Insurance information                    | Built   | `insuranceSummary`                                                                        |
| 17  | Driver age requirements                  | Missing |                                                                                           |
| 18  | Security deposit information             | Built   | Shown before booking; held and released through the ledger (ADR-051)                      |
| 19  | Driver's licence requirements            | Built   | Licence upload and review before a self-drive pickup                                      |
| 20  | Rental booking confirmation              | Built   |                                                                                           |

### Advanced

| Feature                                     | Status  | Evidence, or what is missing                                             |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| Chauffeur-driven vehicle rentals            | Built   | `chauffeurDaily`, a vetted driver assigned at pickup                     |
| Self-drive rentals                          | Built   |                                                                          |
| Airport pickup and drop-off                 | Partly  | Delivery to an address at pickup; no airport branches, no collection     |
| Cross-border rental options where permitted | Missing |                                                                          |
| Vehicle delivery to customers               | Built   | Per kilometre, within the branch's radius                                |
| Corporate fleet rentals                     | Partly  | Company bookings and approvals cover rentals; no fleet or contract rates |
| Long-term rentals                           | Partly  | Up to 30 days, at the daily rate                                         |
| Premium vehicle categories                  | Built   | `luxury`                                                                 |
| Multiple pickup and return locations        | Missing | A car returns to its own branch                                          |
| Additional driver options                   | Missing |                                                                          |
| Child seats and GPS add-ons                 | Missing |                                                                          |

## Totals

|            | Built | Partly | Missing | Lines |
| ---------- | ----- | ------ | ------- | ----- |
| Flights    | 18    | 6      | 5       | 29    |
| Hotels     | 11    | 10     | 8       | 29    |
| Car rental | 19    | 6      | 6       | 31    |
| All        | 48    | 22     | 19      | 89    |
