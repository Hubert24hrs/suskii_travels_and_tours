# Partner supply research: where Suskii gets its prices

- Date: 2026-10-27
- Author: Claude Code, for the owner
- Decision: [ADR-069](../decisions/ADR-069-partner-supply-model.md); tracking in
  [ADR-070](../decisions/ADR-070-affiliate-click-and-conversion-tracking.md); Hotelbeds in
  [ADR-071](../decisions/ADR-071-hotelbeds-hotel-adapter.md)

## The brief

Suskii is an online travel agency like Wakanow or Booking.com. It does not run drivers, cars or
hotels and does not vet third parties (no driver KYC). Prices for flights, hotels, cars and the
rest come from partner APIs, affiliate programmes and partnerships. The platform should earn as
much as possible from that supply.

## How travel agencies earn

| Model                            | We take payment      | We earn                                                                       | Who holds the product risk         |
| -------------------------------- | -------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| **Merchant (net rate + markup)** | Yes                  | The markup we set over the supplier's net price, plus fees                    | We do, until the supplier confirms |
| **Agency (commission)**          | Yes or no            | A commission the supplier pays us                                             | The supplier                       |
| **Affiliate (redirect)**         | No: the partner does | A share of the booking or a fixed fee, paid monthly by the partner or network | The partner                        |

Merchant supply earns the most per booking and keeps the traveller on our site, but needs
contracts or self-serve APIs that sell net rates. Affiliate supply needs no contract, no customer
service and no money handling, and pays from day one; it earns less per booking. The best
approach for a new agency is both: merchant wherever an API sells to us, and affiliate everywhere
else.

## Findings by product

### Flights

| Option                                  | Access                                       | Nigeria fit                                                                                                                                                    | Verdict                                       |
| --------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Duffel** (already integrated)         | Self-serve, sandbox, pay from a balance      | GDS content through Travelport, including Ethiopian, RwandAir, South African Airways, TAAG, Airlink. No Duffel pages for Air Peace or Kenya Airways were found | **Keep as the merchant source**               |
| Amadeus Self-Service                    | **Shut down on 17 July 2026**; keys disabled | n/a                                                                                                                                                            | Not available                                 |
| Amadeus / Sabre / Travelport enterprise | Contract, IATA or a consolidator             | Full GDS content, including local carriers                                                                                                                     | Owner decision (needs IATA or a consolidator) |
| Mystifly, TBO and other consolidators   | Commercial agreement                         | Claimed LCC and GDS mix; nothing Nigeria-specific verified                                                                                                     | Later, with a contract                        |
| Aviasales via Travelpayouts             | Affiliate, self-serve                        | Metasearch; commission is small for flights                                                                                                                    | Optional fallback link only                   |

Wakanow itself added Lufthansa Group NDC through a direct API, so Nigerian leaders mix GDS and
direct airline connections. Domestic carriers (Air Peace, Ibom Air, United Nigeria) still need a
GDS or a consolidator; that is an owner decision recorded in the open questions.

### Hotels

| Option                                | Access                                                                                 | Notes                                                                                                                                 | Verdict                      |
| ------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Duffel Stays** (already integrated) | Needs Stays enabled on the Duffel account                                              | Cheapest-rate search, then full rates                                                                                                 | Keep                         |
| **Hotelbeds APItude**                 | **Free self-serve evaluation key** (50 requests a day); production after certification | Bedbank: net rates, we set the markup. Hotels, transfers and activities in one account. Signed requests (`Api-key` and `X-Signature`) | **Add now (ADR-071)**        |
| RateHawk (ETG API v3)                 | B2B agreement, then sandbox keys, production after certification                       | Strong in emerging markets; net rates                                                                                                 | Next merchant source         |
| Booking.com Demand API                | Managed affiliate contract only; booking needs separate approval                       | Commission is a share of Booking.com's commission                                                                                     | Later, when volume qualifies |
| Expedia Rapid                         | Application; weighs traffic and bookings                                               | 700,000+ properties                                                                                                                   | Later                        |
| Agoda affiliate                       | Application; links and API                                                             | Strongest in Asia-Pacific; about 4 to 7 percent                                                                                       | Optional link                |

Rates from two hotel sources overlap. The search now keeps the cheapest offer when the same
hotel comes from both (ADR-071), so travellers always see the best price we can sell.

### Car rental

| Option                                           | Access                                                                                                                          | Verdict           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| CarTrawler, Rentalcars Connect, Booking.com Cars | B2B contracts, managed or pilot programmes only                                                                                 | Later             |
| DiscoverCars                                     | Affiliate links open to all; the XML API needs a commercial agreement. Long cookie (reported 365 days) and a high revenue share | **Affiliate now** |
| Localrent, Economybookings, QEEQ, GetRentacar    | Through Travelpayouts, which since 27 April 2026 connects programmes automatically                                              | **Affiliate now** |

Our own fleet (the rentals module) needed handover inspections and licence checks. It is
retired from the launch model (ADR-069).

### Airport transfers and in-city rides

| Option                       | Access                                                                                                           | Verdict                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Hotelbeds Transfers          | Same evaluation key as hotels; JSON booking API. The request shape could not be verified from documentation here | Next merchant source, after a sandbox check |
| GetTransfer, Kiwitaxi, Intui | Affiliate through Travelpayouts                                                                                  | **Affiliate now**                           |
| Mozio                        | B2B API; worked with Ethiopian Airlines; Lagos coverage unverified                                               | Later                                       |
| Uber, Bolt                   | Deep links to their apps; no commission                                                                          | Not worth building                          |

Our own ride-hailing (drivers, KYC, payouts, safety tooling) is retired from the launch model.

### Intercity buses (Nigeria)

There is no public bus API. GIGM sells through Travelstart by partnership, and Intercity.ng
aggregates operators. Suskii's bus module already sells operator seats that staff allocate, with
signed boarding passes; that is a partnership model with no driver checks, so it stays.

### Tours and activities

| Option                   | Access                                                                                                                                                                                                      | Verdict        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Viator Partner API**   | **Basic Access is free and needs no approval**; product content, prices and availability; booking happens on viator.com through `productUrl`, tagged with our affiliate id. `campaign-value` tags each link | **Add now**    |
| GetYourGuide Partner API | Gated, certification                                                                                                                                                                                        | Later          |
| Hotelbeds Activities     | Same evaluation key                                                                                                                                                                                         | Later          |
| Tiqets, Klook, WeGoTrip  | Affiliate through Travelpayouts                                                                                                                                                                             | Optional links |

Suskii's own tours and packages (admin-managed inventory) stay: they are partnerships with local
operators, not third-party checks.

### eSIM and travel insurance

| Option                 | Access                                                                                                                            | Verdict                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Airalo                 | Affiliate through Travelpayouts (no brand approval for its feed); the Partner API (we set the selling price) needs an application | **Affiliate now**, Partner API later                        |
| Cover Genius XCover    | Partnership; Nigerian licensing not established                                                                                   | Later; insurance in Nigeria needs a NAICOM-licensed partner |
| EKTA, VisitorsCoverage | Affiliate through Travelpayouts                                                                                                   | **Affiliate now**                                           |

## Affiliate network

Travelpayouts gives one account, one token and one marker for many brands across cars,
transfers, tours, eSIM and insurance. Its Partner Links API turns a brand URL into a tracked
partner link (`POST https://api.travelpayouts.com/links/v1/create`, `X-Access-Token`, body `trs`,
`marker`, `shorten`, `links[{url, sub_id}]`; at most 10 links per call and 100 calls a minute per
marker; some brands are excluded). Postbacks notify the partner of booked, paid and cancelled
bookings; a booking counts only once it is **paid**. Commission rates are set per brand in the
dashboard (older published figures: Viator 10 percent, GetYourGuide 8 to 10 percent,
Rentalcars.com 6 percent, DiscoverCars a high revenue share).

## What earns the most

1. **Markup on merchant supply.** Flights and hotels sold at our price; markups and fees are set
   by staff (`pricing:manage`) per product, route and channel, never in code.
2. **Cross-sell after each booking.** A booked trip already tells us the city and dates. Offering
   the transfer, car, eSIM, insurance and tours for that trip is where affiliate revenue is
   largest, at no extra acquisition cost (`GET /v1/bookings/{id}/partner-offers`).
3. **Suskii Prime and flexible payment.** Already built: membership fees, installment and hold
   fees.
4. **Best-price hotel search.** Two hotel sources, the cheapest shown. Lower prices win more
   bookings, and the markup applies to each.
5. **Commission tracking.** Every click carries our id; every conversion is recorded and reported,
   so staff can see what each partner earns and rebalance placement.

## What makes Suskii different

- One trip, one place: flights and hotels bought on Suskii, plus the transfer, car, eSIM and
  tours for that trip in one list.
- Naira-first prices with flexible payment ("pay small small") on flights and hotels.
- Best price across hotel sources, shown once.
- No own operations to staff, no drivers to vet: margin comes from distribution, not logistics.

## Owner actions

1. Hotelbeds: register at developer.hotelbeds.com for an evaluation key, then certify for
   production.
2. Viator: sign up as an affiliate (Basic Access) at partnerresources.viator.com for an API key.
3. Travelpayouts: create an account and a project; note the API token, the marker and the project
   id (`trs`); connect car rental, transfer, eSIM and insurance programmes; set the postback URL
   (ADR-070).
4. Decide on flights for domestic carriers: IATA accreditation or a consolidator.
5. Later: RateHawk B2B agreement; Booking.com and Expedia applications once volume qualifies;
   Airalo Partner API; a NAICOM-licensed insurance partner.

## Method and limits

Web searches (vendor pages, trade press, developer portals) in October 2026. Vendor
documentation hosts (Hotelbeds, Viator, Travelpayouts) do not resolve from this environment, so
request and response shapes come from search results and from typed client packages on npm:
`hotelbeds.ts` 1.0.2 (types generated from the Hotelbeds OpenAPI), `@otaip/adapter-hotelbeds`
0.7.4 (written against the Hotelbeds sandbox) and `@chrischall/viator-mcp` 2.1.10 (Viator Partner
API v2, Basic Access). Each adapter's first sandbox run confirms the shapes (see the ADRs).

## Sources

- Amadeus Self-Service shutdown: <https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers>,
  <https://airlabs.co/amadeus-self-service-api-shutdown>
- Duffel airlines: <https://duffel.com/flights/airlines/ethiopian-airlines>,
  <https://duffel.com/flights/airlines/rwandair>, <https://duffel.com/flights/airlines/south-african-airways>
- Wakanow and Lufthansa NDC: <https://nigerianflightdeck.com/?p=584680>
- Hotelbeds: <https://developer.hotelbeds.com/documentation/>,
  <https://developer.hotelbeds.com/documentation/hotels/booking-api/workflow/>,
  <https://developer.hotelbeds.com/documentation/transfers/>
- RateHawk / ETG: <https://phptravels.com/integrations/ratehawk-api-integration> (docs at docs.emergingtravel.com)
- Booking.com Demand API: <https://developers.booking.com/demand/docs/getting-started/prerequisites>,
  <https://developers.booking.com/demand/docs/cars/getting-started>
- Expedia: <https://www.altexsoft.com/blog/expedia-taap-rapid-api-partner-solutions>
- Agoda: <https://track360.io/blog/agoda-affiliate-program-operator-teardown-2026>
- DiscoverCars: <https://www.discovercars.com/fr/affiliate>, <https://uppromote.com/affiliate-directory/discover-cars/>
- CarTrawler and car APIs: <https://altexsoft.com/blog/car-rental-apis-integrations-with-gdss-otas-and-tech-providers>
- Mozio: <https://www.prnewswire.co.uk/news-releases/ethiopian-airlines-partners-with-technology-provider-mozio-to-deliver-efficient-ground-transportation-services-to-their-passengers-568137971.html>
- GIGM and Travelstart: <https://techpoint.africa/coverage/gigm-and-travelstart-partner/>, <https://intercity.ng/llms.txt>
- Viator: <https://partnerresources.viator.com/travel-commerce/affiliate/>, <https://docs.viator.com/partner-api/>
- GetYourGuide: <https://supergood.ai/api-report-card/getyourguide>
- Airalo: <https://developers.partners.airalo.com/>
- Cover Genius: <https://covergenius.com>
- Travelpayouts: <https://support.travelpayouts.com/hc/en-us/articles/25289759198226-API-for-Travelpayouts-partner-links>,
  <https://support.travelpayouts.com/hc/en-us/articles/20384016664594-Brands-that-provide-access-to-APIs-and-data-feeds-for-Travelpayouts-partners>,
  <https://support.travelpayouts.com/hc/en-us/articles/4407823569426-Brands-Technical-Integration-with-Travelpayouts>,
  <https://support.travelpayouts.com/hc/en-us/articles/203955653>
- Nigerian market: <https://traveldistributionnews.com/the-continent-that-cant-book-itself-inside-africas-ota-scaling-problem/>,
  <https://tracxn.com/d/explore/online-travel-startups-in-nigeria/__qiAuavT_yXgu0abz1eelOFpOONYcpkfyG3mwgz4bDlM>
