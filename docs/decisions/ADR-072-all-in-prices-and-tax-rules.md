# ADR-072: All-in prices and tax rules per country

- Status: Accepted
- Date: 2026-10-27
- Deciders: owner (pricing display and tax approach), Claude Code (design)
- Context: [ADR-008](ADR-008-money-pricing-and-fx.md), [ADR-035](ADR-035-admin-managed-pricing-promos-deals-and-content.md), [ADR-051](ADR-051-cars-payments-holds-and-deposits.md)

## Context

The owner asked for US and European standards in African markets. US rules (the FTC rule on
unfair fees) and EU rules (price indication and consumer rights) require the price a customer
first sees to be the price they pay, with every mandatory fee and tax in it. Nigeria (VAT 7.5%),
Kenya (16%), South Africa (15%) and Ghana (VAT and levies) all tax a travel agent's own service.

Today `price.total` already includes the fare, supplier taxes and our fees, and every list shows
it. What is missing is tax on Suskii's own service. As an agent, Suskii's taxable supply is its
margin and fees; for products it sells as principal (in-house tours, packages, visa assistance,
add-ons, Prime, and Cars as merchant) it is the whole price.

## Decision

1. **Tax rules are data.** `tax_rules` holds, per country: a code and label (`vat`, "VAT"), a
   rate in basis points, a basis, an optional vertical (none means every vertical), validity
   dates, an active flag and the registration number printed on receipts. Staff with
   `pricing:manage` edit them with a fresh authenticator check, audited like markups and fees
   (ADR-035, ADR-037). Nothing is seeded: the owner's accountant supplies the rates.
2. **Two bases.**
   - `margin`: Suskii's markup (after any Prime share) plus its fees, less any promo discount,
     never below zero. For bookings sold as agent.
   - `full`: fare plus fees, less the discount; supplier taxes are never taxed again. For
     products sold as principal.
3. **Added on top, shown in the total.** Each matching rule adds a `serviceTaxes` line
   (`code`, `label`, `rateBps`, `amount`, `registrationNumber`), rounded half-up.
   `total = fare + taxes + fees + serviceTaxes - discount`. Every list, deal and checkout
   already shows `total`, so the first price a customer sees includes the tax. Promos stay off
   fare and fees, and the member saving keeps its meaning (markup given back and fees waived).
4. **The seller's country decides.** A price must be final at search time, before anything is
   known about the buyer, so the rules applied are the selling entity's: `TAX_SELLER_COUNTRY`
   (default `NG`). Rules for other countries can be prepared in advance; when Suskii operates
   an entity in another country, that market's sales use its rules (a per-market setting, not
   a new design).
5. **Cars keep their fare VAT.** `CARS_VAT_BPS` stays the operator-fare VAT inside Cars fares.
   A `full` rule on buses, rides or rentals is refused while it is set, so no fare is taxed
   twice; a `margin` rule may still tax Suskii's own fees on them.
6. **Hotel taxes collected at the property** stay outside the total (the supplier collects
   them), and every place that shows a hotel price now says so beside it.
7. **Receipts** print each tax line with its rate and the registration number. The stored price
   of an offer or booking keeps the lines, so a receipt never changes when a rule does.
8. **No ledger change yet.** The ledger does not split revenue today; the tax collected is
   reported from stored prices. A `tax-payable` account comes with revenue recognition.

## Consequences

- With no rule, every price is unchanged.
- A new rule applies to the next search or quote within the one-minute rule cache; quotes
  already given keep their price.
- `serviceTaxes` is an additive response field; older app builds show the same total without
  the tax line.
- One deployment charges one country's rules. Selling from several entities needs a per-market
  setting first.
