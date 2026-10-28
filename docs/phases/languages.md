# Languages: French, Swahili, Arabic and Portuguese

Item 5 of the standards plan agreed with the owner on 2026-10-27. Decision record:
[ADR-076](../decisions/ADR-076-languages-and-right-to-left.md).

## Owner's answer this work follows

French, Swahili, Arabic (right to left) and Portuguese, on the website and in the app.

## Where the platform stands

- `@suskii/i18n` has one catalog (`en`, about 2,500 lines) used for `en-NG` and `en-GB`, and an
  American overlay for `en-US`. The translator already selects plural forms with
  `Intl.PluralRules`, so Arabic's six forms need no new machinery.
- The website picks the language from the footer (`__Host-suskii_locale`) and otherwise uses
  `en-NG`; it ignores the browser's `Accept-Language`. `<html>` has `lang` but no `dir`.
- The website and ui-web use 26 physical direction utilities (`ml-`, `pr-`, `left-`,
  `text-right`, ...), which would not mirror in a right-to-left page.
- The app follows the device language among `en-NG`, `en-GB` and `en-US`. Hermes needs polyfill
  data per language for plural rules, relative times, lists and display names.
- The console, emails, texts, push notifications and PDFs are English. They stay English in this
  item (see ADR-076).

## Plan

| Step | Work                                                                                                                                     | Files                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1    | Locales `fr`, `sw`, `ar`, `pt`; `localeDirection()`; `negotiateLocale()` for `Accept-Language` and device languages                      | `packages/shared/src/locale*.ts`                 |
| 2    | Catalogs `fr`, `sw`, `ar`, `pt`, complete by type; tests for matching placeholders, plural forms and no English left in place by mistake | `packages/i18n/src/messages`                     |
| 3    | Formatters with Latin digits in every language; language names in their own language for the picker                                      | `packages/i18n/src/format.ts`, `locale-names.ts` |
| 4    | Website: `lang` and `dir`, logical direction utilities, mirrored arrows, `Accept-Language` when nothing is chosen, the footer picker     | `apps/web`, `packages/ui-web`                    |
| 5    | App: device language by language, right to left from the device, polyfill data for the new languages                                     | `apps/mobile`                                    |
| 6    | Tests: website e2e in Arabic (direction, copy, axe) and French, the hydration check per language, app Jest for language choice           | `apps/web/e2e`, `apps/mobile/src`                |
| 7    | Docs: ADR-076, CLAUDE.md, CHANGELOG                                                                                                      | `docs/`                                          |

## Risks

- **Translation quality.** The catalogs are drafted by Claude Code from the English. Booking,
  payment and refund wording needs a native speaker's review before production; that is an open
  question for the owner.
- **Text length.** French and Portuguese run about 20 to 30% longer than English. Buttons and
  tabs must wrap or truncate cleanly; the responsive e2e runs in French.
- **Mixed direction.** Airport codes, flight numbers, booking codes and prices are Latin inside
  Arabic sentences. They are isolated so they do not reorder.
- **App bundle size.** Polyfill data for four languages adds to the app bundle; only plural rules,
  relative times, lists and display names need it.
