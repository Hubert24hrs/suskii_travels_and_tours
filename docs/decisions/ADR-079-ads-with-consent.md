# ADR-079: Ads with consent

- Status: Accepted
- Date: 2026-10-28
- Deciders: Claude Code (implementer), pending owner review

## Context

Item 8 of the standards plan: growth through social media ads on TikTok, Facebook and Instagram.
Those networks optimise campaigns on conversions they can see: a browser tag (Meta Pixel, TikTok
Pixel) and, because browsers and blockers drop a share of tags, the same events sent from the
server (Meta Conversions API, TikTok Events API) with an event id that lets the network keep one.

Both send personal data to the network (the tags set identifiers in cookies; the server events
carry a hashed email or phone). The Nigeria Data Protection Act 2023, the GDPR and the ePrivacy
rules allow that only with a prior, specific choice. ADR-042 built the consent record and listed
what the first marketing tag must bring.

## Decision

1. **Runtime settings, website only.** `META_PIXEL_ID` and `TIKTOK_PIXEL_ID` are read by the
   website at request time (pages render per request), so one build serves every environment and
   tests can set them. Unset means no tag, no prompt and no CSP change. The app stays free of ad
   SDKs (ADR-042 rule 7); app install campaigns are an owner decision for later.
2. **First-visit prompt.** While a tag is configured and the visitor has no choice under the
   current policy, a bottom prompt offers "Accept all" and "Reject all" with equal weight, and
   "Choose" (the existing dialog). Its code loads after the page is interactive and it is
   fixed-position (no layout shift); the homepage budget stays at 170 kB. `COOKIE_POLICY_VERSION`
   becomes 2, so every earlier choice is asked again.
3. **Tags load only after `marketing` consent**, from our own bundle (trusted by
   `strict-dynamic`), and stop at the next page load after a withdrawal. The CSP adds the
   networks' `connect-src` and `img-src` hosts only when that network is configured.
4. **Browser events** are standard names with trip facts only: `PageView`, `Search` (vertical and
   IATA codes), `ViewContent`, `InitiateCheckout` and `Purchase` (value and currency from the API's
   `Money`, event id = booking id), `CompleteRegistration`. No name, email, phone or booking
   reference in the browser; the networks' automatic advanced matching stays off.
5. **Server events** (`Purchase` only) go through `AdConversionsProvider` (mock, Meta, TikTok;
   `AD_CONVERSIONS`), never from request code:
   - At booking time the website sends `marketing: { consentId, click ids }` only when its
     consent cookie allows marketing. The API keeps them only when the latest recorded choice for
     that consent id, under the current policy, says marketing is on; otherwise it drops them
     silently. The browser's word is never enough.
   - A worker sweep sends paid bookings' conversions (event id = booking id, value and currency,
     SHA-256 of the normalised contact email and phone, the click ids), retries three times, then
     gives up, and clears the click ids and consent id once sent or after 30 days.
   - Tokens are secrets in Secret Manager; production refuses the mock unless
     `ALLOW_MOCK_PROVIDERS=true` while a network is configured.
6. **Privacy records.** The click ids are personal data (pseudonymous identifiers): the data
   registry, data classification, external communications and the store forms (website only)
   are updated; account deletion clears them with the booking's contact data.

## Consequences

- The owner can run TikTok, Facebook and Instagram campaigns that optimise on real bookings
  once they create the pixels and tokens.
- A visitor who rejects or ignores the prompt sends nothing to any network; a test proves it.
- Open for the owner: the pixel ids and tokens, the cookie policy text, and whether to run app
  install campaigns (they need an SDK or a measurement partner and their own consent screen).
