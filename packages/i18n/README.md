# @suskii/i18n

Message catalogs, a typed translator and `Intl` formatters shared by the web app and (from phase 7)
the mobile app. No runtime dependency beyond `@suskii/shared` (ADR-010).

- `src/messages/en.ts` is the base catalog (British spelling, used for `en-NG` and `en-GB`);
  `en-US.ts` overlays American spelling. Every locale must expose the same keys (tested).
- Placeholders use `{name}`. Plural leaves are objects with `one`, `other` and optional `zero`,
  selected with `Intl.PluralRules`.
- Business facts (prices, phone numbers, legal texts, trust claims) never live in the catalog: they
  come from the CMS through the API.

```ts
import { createFormatters, createTranslator, getMessages } from '@suskii/i18n';

const { t } = createTranslator(getMessages('en-NG'), 'en-NG');
t('common.hotels', { count: 248 }); // "248 hotels"

const format = createFormatters('en-NG');
format.moneyFrom({ amountMinor: 45_000_001, currency: 'NGN' }); // "₦450,001" (rounded up)
format.date('2026-12-10'); // "10 Dec 2026"
```

React apps wrap client components in `I18nProvider` (from `@suskii/i18n/react`) with only the
namespaces they need, then call `useTranslator()` and `useFormatters()`.
