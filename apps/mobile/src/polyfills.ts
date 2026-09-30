/**
 * Hermes implements Intl.Collator, DateTimeFormat and NumberFormat only. @suskii/i18n also uses
 * PluralRules (the translator), RelativeTimeFormat and ListFormat (formatters), which need
 * Intl.Locale and getCanonicalLocales. Each `polyfill.js` installs only where the engine lacks
 * the API, so Node (Jest) and JavaScriptCore keep their native versions. Order matters: every
 * polyfill depends on the ones above it. Data for the app's locales (en-NG, en-GB, en-US = en)
 * keeps the output identical to the website's native Intl (no serial comma outside en-US).
 */
import '@formatjs/intl-getcanonicallocales/polyfill.js';
import '@formatjs/intl-locale/polyfill.js';
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-relativetimeformat/polyfill.js';
import '@formatjs/intl-relativetimeformat/locale-data/en.js';
import '@formatjs/intl-relativetimeformat/locale-data/en-GB.js';
import '@formatjs/intl-relativetimeformat/locale-data/en-NG.js';
import '@formatjs/intl-listformat/polyfill.js';
import '@formatjs/intl-listformat/locale-data/en.js';
import '@formatjs/intl-listformat/locale-data/en-GB.js';
import '@formatjs/intl-listformat/locale-data/en-NG.js';
