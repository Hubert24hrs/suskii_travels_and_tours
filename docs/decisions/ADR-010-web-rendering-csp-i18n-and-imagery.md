# ADR-010: Web rendering, CSP, preferences, i18n and imagery

- Status: Accepted
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

The homepage must hit Lighthouse mobile >= 90 performance and 100 accessibility and SEO, stay
under 170 kB of gzipped JavaScript, and follow the security spec: "Strict CSP with nonces (Next.js
middleware)". The spec's performance tactics also suggest ISR for deals and destination pages.
Copy must live in message catalogs shared with the mobile app, and imagery must be licensed.

## Decisions

### Nonce CSP wins over page-level ISR

Next.js applies nonces while rendering a request, so a nonce CSP requires dynamic rendering; static
generation, ISR and Partial Prerendering cannot carry a per-request nonce (Next.js 16 CSP guide).
The experimental hash-based alternative (SRI) does not cover Next's inline scripts. Security wins:

- `proxy.ts` (Next 16's middleware) generates a nonce per request and sets
  `script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `frame-ancestors 'none'`, `connect-src` limited to the API origin and
  Turnstile, `frame-src` limited to Turnstile, `upgrade-insecure-requests`. `'unsafe-eval'` only in
  development (React debugging).
- `style-src 'self' 'unsafe-inline'`: React and `next/image` render inline `style` attributes that
  nonces cannot cover. Style injection is a far smaller risk than script injection; scripts stay
  strict.
- Pages render per request and **data** is cached instead: server components call the API with
  `fetch(…, { next: { revalidate, tags } })` (content and deals 5 minutes, catalog 1 day). A render
  is a few cached lookups plus React, so HTML arrives quickly; the static JS and CSS are immutable
  and CDN-cached.
- Static headers (HSTS, nosniff, Referrer-Policy, Permissions-Policy) come from `next.config.ts`.

### Preferences without locale-prefixed URLs

Currency (header selector) and locale (footer selector) are stored in functional cookies
(`suskii_currency`, `suskii_locale`; no consent needed) set by a server action. The three supported
locales are all English and differ only in formatting, so URLs stay unprefixed and canonical. When
French or Pidgin arrive, locale-prefixed routes and `hreflang` replace the cookie.

### Home-grown, typed i18n (`@suskii/i18n`)

A typed English catalog with regional overlays, a translator with `{name}` interpolation and plural
forms through `Intl.PluralRules`, and `Intl`-based money, date, range and relative-time formatting.
No runtime dependency: next-intl and use-intl pull an ICU parser into the client bundle, and the
same catalogs must run in React Native (phase 7). Server components translate; client components
receive only the strings they need as props, which also keeps the component libraries copy-free.

### Homepage JavaScript

Only interactive parts are client components: the search module, header controls, deals filter and
newsletter form. The flights form ships with the page; the other five tab forms load on demand. No
data-fetching library on the homepage (autocomplete uses the edge-cached popular index plus a small
abortable fetch); TanStack Query arrives with the results pages in phase 5.

### Search pages that later phases complete

Forms navigate to their final URLs (`/flights/search?…`, `/hotels/search?…`, `/packages?…`, and so
on). Until results exist (phase 5 for flights and hotels, phase 8 for the rest), those pages show
the parsed search in the pre-filled form with a short availability notice, and are `noindex`.
Header links to sign in, manage booking and Suskii Prime point to their final routes; the 404 page
offers search and navigation until phases 5-9 build them.

### Imagery

The spec requires licensed or royalty-free photography. No brand assets exist yet (open owner
question) and the photo hosts are blocked from the build sandbox, so the site ships original SVG
illustrations built from design tokens (route art on deal cards, city art on destination cards, a
light hero illustration on desktop). They weigh almost nothing, so they never become the LCP
bottleneck. `DestinationContent.imageUrl` (CMS) switches a card to a real photo served by
`next/image` as AVIF/WebP; allowed image hosts come from `IMAGE_REMOTE_HOSTS`.

### Structured data

JSON-LD: Organization (name and URL only until legal and brand details exist), WebSite, FAQPage for
the published FAQs and BreadcrumbList on inner pages. The spec's `WebSite` `SearchAction` is left
out: Google retired the sitelinks search box in 2024 and the site has no free-text search endpoint
to point it at. Add it with the AI search box (phase 13).

## Consequences

- No full-page CDN caching for HTML; revisit if traffic makes per-request rendering expensive (for
  example with SRI once it is stable and covers inline scripts).
- The Lighthouse check runs against a production build with the real API, so data latency is part
  of the measurement.
- Photos become a content task: once licensed images exist they are set per destination in the CMS
  without code changes.
