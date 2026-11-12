# ADR-035: Admin-managed pricing, promos, deals and content

- Status: Accepted
- Date: 2026-10-06
- Deciders: Claude Code (implementer), pending owner review

## Context

Markup and fee rules (ADR-008), promo codes, deal routes and destination content (ADR-011), CMS
blocks, FAQs and trust signals have been seeded or left empty since their phases, with a note that
the admin console would manage them. They change prices and public claims, so edits need guard
rails and a trail.

## Decisions

1. **Permissions.** Markup and fee rules: `pricing:manage` (finance, super admin). Promo codes and
   deal routes: `deals:manage` (operations, content managers). Destination content, CMS blocks and
   FAQs: `cms:manage`. Trust signal text: `cms:manage`; verification: `trust-signals:verify`
   (super admin only: regulated claims such as IATA accreditation need proof, phase 4).
2. **No hard deletes where history matters.** Rules, promos and deal routes are deactivated
   (`active: false`); CMS blocks and FAQs are unpublished; destinations are unpublished. Promo
   codes that have been redeemed keep their code; a promo's code cannot change after its first
   redemption.
3. **Validation.** Markups are never negative (discounts are promo codes); percentage values are
   basis points from 0 to 10,000 and fixed values are minor units with a currency; caps need a
   currency; validity windows must end after they start. Fee codes are lowercase identifiers.
   Promo codes are 4 to 20 upper-case letters and digits. CMS block content is validated against
   the schema the public site parses for that key (`cmsContentSchemas`, `pageContentSchema` for
   `page.*`), so a block that would be ignored as malformed cannot be saved.
4. **Trust signals.** Editing a signal's label or value clears its verification (the claim
   changed, so the proof must be re-checked). Verifying needs an `https` evidence URL and records
   who verified it and when. Only verified signals render (existing rule).
5. **Audit.** Every change records its action with the before and after values that matter
   (amounts, active flags, verification), never personal data.
6. **Cache windows.** The website caches these reads (ADR-010): markups and fees apply to the
   next search or quote; deals refresh on the worker's schedule; content, FAQs and trust signals
   show within five minutes; destination pages within a day. A cache-purge hook from the API to
   the web is left for deployment (phase 12).

## Consequences

- The owner's commercial settings (markups, fees, promos) can be entered without a deploy and
  are traceable to a person.
- Regulated claims stay hidden until a super admin attaches evidence.
