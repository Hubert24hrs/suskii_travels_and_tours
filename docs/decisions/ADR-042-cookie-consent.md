# ADR-042: Cookie consent

- Status: Accepted
- Date: 2026-10-06
- Deciders: Claude Code (implementer), pending owner review

## Context

The ePrivacy rules (and the UK and EU GDPR guidance on them), and the Nigeria Data Protection Act
2023, allow strictly necessary cookies without consent. Anything else needs a prior, specific
choice that the business can prove later. Phase 11 found that the website had no cookie list and
no way to make or record a choice.

Today every cookie and storage key on the site is strictly necessary:

- the API's session, refresh and CSRF cookies;
- the currency and language the visitor picks;
- the session expiry hint;
- guest booking tokens in the tab, the last flight search, and the add-on lookup surname;
- Cloudflare Turnstile on protected forms.

There is no analytics or marketing tag. `POSTHOG_KEY` in `.env.example` is unused.

## Decisions

1. **One catalog.**
   - `apps/web/lib/cookie-catalog.ts` lists every cookie and storage key: name, kind, category,
     provider, purpose and lifetime (the copy lives in `@suskii/i18n`).
   - `e2e/cookies.spec.ts` goes through a visit that touches every kind of storage, then fails if
     the browser holds a cookie or storage key the catalog does not list.
2. **Categories.**
   - `necessary` is always on.
   - `analytics` and `marketing` (`OPTIONAL_COOKIE_CATEGORIES` in `@suskii/shared`) are off
     until the visitor turns them on.
   - Choices the visitor makes on the site (currency, language, consent) count as strictly
     necessary, because they only store what the visitor asked for.
3. **Recorded before stored.**
   - Saving in the dialog first calls `POST /v1/privacy/cookie-consents` with a random consent id,
     the policy version and the choices. Only after a 201 does the browser write the
     `suskii_consent` cookie (`<version>.<consentId>.<flags>`, one year, `SameSite=Lax`, `Secure`
     on https) and fire `suskii:consent`.
   - When recording fails, nothing changes and the visitor is told.
   - Each save adds a row, so the history of choices for a consent id stays provable.
4. **Pseudonymous records.**
   - A `cookie_consents` row holds the consent id, the policy version, the choices and the time.
     It holds no account, IP address or user agent.
   - The daily retention sweep removes rows after 730 days (a year in force plus a year to answer
     questions).
   - The data registry lists the table as holding no personal data.
5. **Policy version.**
   - `COOKIE_POLICY_VERSION` (shared) is part of the cookie. A choice made under another version
     reads as no choice, so optional categories are off again.
   - Bump the version whenever an optional cookie is added, or the list changes in a way a
     visitor would want to reconsider.
6. **No banner while nothing optional exists.**
   - The footer's "Cookie settings" opens the list and the choices. The dialog code loads on
     first use, so the homepage JavaScript does not grow (ADR-013).
   - A first-visit prompt that asks about nothing would be noise and would cost the homepage
     performance budget. The cookie test asserts that no optional entry exists yet.
   - The change that adds the first optional cookie must also add:
     - a first-visit prompt with equal "Accept" and "Reject" choices;
     - a version bump;
     - a `hasCookieConsent(category)` check before the tool loads, with a listener for
       `suskii:consent` so it can start after a choice.
7. **Mobile.** The app sets no cookies and has no analytics or advertising SDK, so it needs no
   consent screen. An SDK added later goes through the same review.

## Consequences

- The website can show exactly what it stores, and the test keeps the list honest.
- Adding analytics later is a small change with a clear checklist, and it cannot quietly
  bypass consent.
- Open for the owner:
  - whether to add analytics, and which tool (a cookie-less option needs no consent);
  - the cookie policy page in the CMS (legal text), which the footer will link next to the
    settings once published.
