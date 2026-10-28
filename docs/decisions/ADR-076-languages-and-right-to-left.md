# ADR-076: Languages and right to left

- Status: Accepted
- Date: 2026-10-28
- Deciders: owner (the languages), Claude Code (design)
- Context: [ADR-010](ADR-010-web-rendering-csp-i18n-and-imagery.md),
  [ADR-020](ADR-020-mobile-app-architecture-storage-and-offline.md)

## Context

The owner asked for French, Swahili, Arabic and Portuguese, the languages of most of our African
markets after English. Arabic is written right to left. The website and the app take all their
copy from `@suskii/i18n`, whose translator already handles plural forms through
`Intl.PluralRules`, so the work is the catalogs, the direction of the layout and choosing the
language.

## Decision

1. **Language tags.** The new locales are `fr`, `sw`, `ar` and `pt`, without a region: one catalog
   serves every market that speaks the language, and their number and date conventions are the
   same across those markets. English keeps `en-NG` (default), `en-GB` and `en-US`.
2. **Latin digits everywhere.** The formatters ask `Intl` for Latin digits (`numberingSystem:
'latn'`) in every language. CLDR's default for Arabic is Arabic-Indic digits, but prices,
   times, flight numbers and booking codes must read the same as on tickets, airline counters and
   text messages, as on the large travel sites in Arabic.
3. **Right to left.** `localeDirection()` in `@suskii/shared` says `rtl` for Arabic. The website
   sets `<html lang dir>`; the website and ui-web use logical direction utilities only (`ms-`,
   `pe-`, `start-`, `text-start`, ...), and a guard test fails on physical ones. Arrows and chevrons
   mirror with the `rtl:` variant. In a right-to-left language the translator isolates every
   value it inserts (Unicode FSI and PDI), so a Latin airport code, price or booking code never
   reorders the sentence around it. The app follows the device: `expo-localization`'s
   `supportsRTL` lets React Native mirror the layout when the device is in Arabic.
4. **Choosing the language.** On the website, the footer choice (`__Host-suskii_locale`) wins;
   without one, the first language in the browser's `Accept-Language` that we have; else `en-NG`.
   A language matches by its language subtag (`fr-CI` is `fr`), and English regions match exactly
   or fall back to `en-NG`. The app applies the same rule to the device's languages.
5. **Language names.** The picker lists each language in its own language and script
   ("Français", "Kiswahili", "العربية", "Português"), with `lang` on each, whatever the page's
   language.
6. **Scope.** The website and the app are translated. The staff console, emails, text messages,
   push notifications and PDFs stay English for now: they are rendered by the API, which does not
   yet know a traveller's language. The API's problem titles are English; clients already show
   their own copy for the problems a traveller can meet. A traveller's language on the account,
   and notifications rendered in it, are a later step.
7. **Same URLs.** Every language shares the same URLs (the language is a preference, as in
   ADR-010), so search engines index the English pages. Language-prefixed URLs with `hreflang`
   are a later step if search traffic in these languages matters.
8. **Translations.** The catalogs are drafted by Claude Code from the English one. The catalog type
   makes every key required, and tests check that each translation keeps the English
   placeholders, has the plural forms its language needs and has no string still in English.
   A native speaker reviews each language before production.

## Consequences

- A traveller in Dakar, Nairobi, Cairo or Luanda gets the site and the app in their language
  without choosing anything, and the choice stays a footer away.
- Every new string needs five catalog entries (English plus four). The type check fails until
  all are there; until the review, a new string in another language is Claude Code's draft too.
- Bookings, payments and refunds still send English emails and texts, which travellers who chose
  another language may not expect. The account language step fixes that.
- Physical direction utilities can no longer be used in the website or ui-web.
