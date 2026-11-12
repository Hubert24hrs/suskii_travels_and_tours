# ADR-021: Mobile payments, deep links and app links

- Status: Accepted
- Date: 2026-09-30
- Deciders: Claude Code (implementer), pending owner review

## Context

Payments use hosted checkout only (SAQ-A, ADR-016). The spec wants payment "via provider SDK or
hosted page" on mobile, webhooks as the source of truth with redirects only triggering a status
poll, and deep links validated through universal links or app links with allowlisted paths and no
tokens in URLs. Providers require `https` return URLs (Stripe, Paystack and Flutterwave reject
custom schemes).

## Decisions

1. **System browser, not a WebView.** The app opens the provider's checkout URL with
   `expo-web-browser`'s authentication session (ASWebAuthenticationSession on iOS, Chrome Custom
   Tabs on Android). The traveller sees the provider's real address and padlock, the app cannot
   read or inject into the page, and provider features that refuse WebViews keep working. Provider
   React Native SDKs are not used: they either wrap a WebView or need card data in the app.
2. **Return through the web.** For mobile clients (`X-Suskii-Client: mobile-*`) the API sets the
   provider's return URL to `WEB_APP_URL/mobile/payment-return?booking={id}`. That page (noindex,
   no data) redirects to `suskii://trips/{id}` and shows an "Open the app" button in case the
   browser blocks the automatic jump. The authentication session closes on the custom-scheme
   redirect and the trip screen polls the booking until the webhook has decided the outcome. If
   the traveller closes the browser instead, the app still shows the trip with its current status
   and the payment button. The client header is not trusted for anything else: spoofing it only
   changes where the browser goes after payment.
3. **One scheme.** Every build variant uses the `suskii` scheme so the return page works for all
   of them; a device with two variants installed may ask which one to open.
4. **Allowlisted deep links.** `app/+native-intent.tsx` rewrites every incoming URL before the
   router sees it. Accepted: `suskii://trips/{uuid}`, `https://<web host>/bookings/{uuid}`
   (the emailed booking link), `/flights/search?...` and `/hotels/search?...` (re-validated with
   the shared search parsers), `/deals`, `/account`. Anything else, including other hosts, opens
   Home. Query strings are dropped except for validated search parameters.
5. **Tokens in links.** The only token that can arrive in a link is the guest access token in the
   fragment of an emailed booking link (`#access=`, ADR-018). The app moves it into the secure
   store and navigates to the trip without it; it is never logged or passed to the router.
6. **App links.** The web app serves `/.well-known/assetlinks.json` and
   `/.well-known/apple-app-site-association` from environment values (Android package name and
   signing certificate fingerprints, Apple team id and bundle id); both answer 404 until the owner
   provides them. The app declares `/bookings/*`, `/flights/search`, `/hotels/search` and
   `/deals` only; marketing pages stay on the web.

## Consequences

- The return page is one extra hop, but it is the only return path every provider accepts, and it
  degrades to a tap when Chrome blocks the scheme redirect.
- App links activate only after the owner supplies the store identifiers and the web host serves
  the files over `https`.
