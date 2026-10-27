# All-in prices and the tax table

Item 1 of the standards plan agreed with the owner on 2026-10-27 (US and European standards for
African markets). Decision record: [ADR-072](../decisions/ADR-072-all-in-prices-and-tax-rules.md).

## Owner's answers this work follows

- Prices: the full price, every mandatory fee and tax included, from the first search result.
- Tax: a table of rules per country, managed in the admin console, with VAT shown on receipts;
  the owner's accountant confirms the rates. Nothing is seeded.
- Sales model: agent of licensed partners; packages sold in Africa only.

## Where the platform stands

- Search results, deals and checkout already show `price.total`, which is fare (supplier base and
  our markup), supplier taxes and our fees. Promos come off fare and fees.
- No tax is charged on Suskii's own service (margin and fees, or the whole price of in-house
  products). `CARS_VAT_BPS` adds VAT to Cars fares only, as part of the operator's fare.
- Hotel taxes collected at the property (`payAtProperty`) show on the website's results, room
  list and checkout, and on the app's room list; the app's hotel results and checkout leave them
  out.
- Receipts show the total paid, with no tax line.

## Plan

| Step | Work                                                                                                                                                                                       | Files                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 1    | `TaxRule` model (country, code, label, rate in basis points, basis `margin` or `full`, optional vertical, validity, registration number) and an expand-only migration; data registry entry | `prisma/schema.prisma`, migration, `src/privacy/data-registry.ts` |
| 2    | Engine: `serviceTaxes` computed after the discount on Suskii's margin and fees (`margin`) or on fare and fees (`full`); `total` includes them; unit tests                                  | `src/pricing/pricing-engine.ts`, spec                             |
| 3    | `PricingService` loads the seller country's rules with markups and fees (same cache and invalidation); `TAX_SELLER_COUNTRY` setting                                                        | `src/pricing/pricing.service.ts`, `src/config/env.schema.ts`      |
| 4    | Wire: `serviceTaxes` on `Price` (additive, default empty); OpenAPI and client regenerated                                                                                                  | `src/pricing/pricing.schemas.ts`, generated files                 |
| 5    | Admin: list, create and update tax rules (`pricing:manage`, step-up, audited); refuse a `full` rule on Cars verticals while `CARS_VAT_BPS` is set                                          | `src/admin/admin-pricing.*`, audit actions, admin e2e cases       |
| 6    | Console: a Taxes section on the pricing page                                                                                                                                               | `apps/admin`                                                      |
| 7    | Receipts: each tax line, its rate and the registration number on booking PDFs                                                                                                              | `src/documents/booking-pdf.ts`                                    |
| 8    | Website and app: tax lines in checkout and booking summaries; pay-at-property note beside hotel prices in results                                                                          | `apps/web`, `apps/mobile`, `@suskii/i18n`                         |
| 9    | Docs: ADR-072, CLAUDE.md, CHANGELOG, access control, settings in `.env.example`, Terraform and Helm                                                                                        | `docs/`, `infra/`                                                 |

## Risks

- **Changing totals.** With no rule, every price is unchanged (tested). A rule changes totals on
  the next search; quotes already given keep their price, as with markups.
- **Double tax on Cars.** `CARS_VAT_BPS` already puts VAT inside Cars fares; the admin API
  refuses a `full` rule on buses, rides or rentals while it is set.
- **Old stored prices.** Offers and bookings store the price as JSON; `serviceTaxes` defaults
  to empty, so stored prices read as before.
- **Mobile contract.** The field is additive; older app builds ignore it and still show the
  right total.

## Outcome

All nine steps are built.

- API: `tax_rules` (expand-only migration with range and country checks), the engine's
  `serviceTaxes` (six new unit cases and the property test cover them), the seller-country
  loader with the rule cache, and the admin routes with step-up and audit. `tax-rules.e2e-spec.ts`
  follows a rule from the admin API to every search result's total, a booking, its total and its
  e-ticket; it also checks that another country's rule and a deactivated rule are never applied,
  that validation matches the console, and that whole-price rules on Cars are refused while
  `CARS_VAT_BPS` is set. The admin matrix and audit suites cover the new routes.
- Console: a Taxes section on the pricing page (admin e2e journey).
- Receipts: tax lines with rate and registration number on every booking PDF (unit tests).
- Website and app: tax lines in checkout (a Playwright check and a Jest case); the app's hotel
  results and checkout note city tax paid at the hotel (Jest case for checkout).

Waiting on the owner: the rates, bases and registration numbers per country from the accountant.
Later items of the standards plan that build on this: the automatic refund offer (item 2) refunds
the tax with the share it refunds, and revenue recognition adds a `tax-payable` ledger account
(ADR-072, decision 8).
