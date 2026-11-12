# Date and time pickers in the app

Outside the numbered phases. ADR-109 left one exception to the owner's plain copy: twelve fields
in the app took a date or a date and time as typed text, under a hint that showed the form the API
reads (`2026-12-01`, `2026-12-01T14:30`). The owner asked for pickers in their place. The decision
is ADR-114; this page is the plan and, at the end, what was done.

## What was asked

- Each of the twelve fields opens a picker: a date picker that reaches a birth year quickly (a
  year and month choice, not only a month grid) and, for a date and time, a time on the 24 hour
  clock.
- The screens send exactly what they sent before: no API or schema change.
- The value is shown in words through the i18n formatters; the four hints leave every catalog,
  and the hyphen test loses its allowance for dates.
- The phone flows and the screen tests choose dates in the picker; the accessibility rules still
  pass; lint, type checks and tests pass.

## Plan

| Area       | Files                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Components | `ui-native`: `components/date-picker.tsx` (new), `calendar/date-value.ts` (new, the ISO values), `components/sheet.tsx` (`scrollRef`), `components/field-button.tsx` (`error`), `index.ts`, tests                                                                                                                                         |
| App        | `components/date-field.tsx` (new: `DateField`, `DateTimeField`), `lib/dates.ts` (bounds), `lib/cars.ts` (rental and ride bounds), the seven files with the fields: `passenger-form.tsx`, `rental-licence.tsx`, `rental-search-screen.tsx`, `rental-car-screen.tsx`, `ride-request-screen.tsx`, `checkout-screen.tsx`, `driver-screen.tsx` |
| Tests      | `src/test/app.tsx` (`chooseDate`, `pinClock`), `src/test/fixtures.ts` (a transfer quote), the checkout, driver, Cars and trip planning screen tests                                                                                                                                                                                       |
| Catalogs   | every language: `mobile.datePicker` added, the four hints removed; `catalogs.test.ts`                                                                                                                                                                                                                                                     |
| Flows      | `subflows/choose-date.yaml` (new), `critical-path.yaml`, `cars-bus.yaml`, `inhouse-tour.yaml`, `trip-builder.yaml`, `subflows/traveller.yaml`                                                                                                                                                                                             |

Risks, and how each is met:

- **A changed value.** The picker keeps and sends the ISO strings the fields held; tests assert
  the exact strings the API receives (a booking, a rental quote, a ride's instant, a transfer's
  arrival).
- **A native dependency.** None: the picker is built on the sheet the other pickers use, so the
  Android build and the trust policy are untouched (ADR-114 says why no native module).
- **Tests that age.** Fixed future days stop being choosable once they pass; tests that choose
  them pin the phone's date (`pinClock`, `Date` only, timers keep running).
- **Flows with no keyboard.** `hideKeyboard` presses Back on Android when no keyboard is open, so
  the date steps no longer call it.
- **Right to left.** Rows mirror with the layout; the previous and next arrows are chosen by
  direction; names come from Intl in the Latin-digit locale.

## Outcome

Built as planned.

- `DatePicker` in ui-native: years (from the end nearer today, opening at the year on show),
  months, days with previous and next, and for a date and time the hours `00` to `23` and minutes
  every five. Done keeps the value and waits for a complete one; closing keeps the old value.
- The twelve fields use `DateField` or `DateTimeField` with the bounds in ADR-114's table: dates
  of birth back 120 years, expiry dates from today, a rental from today where the car is, a ride
  within a week, a transfer's arrival around its own day.
- The four hints are gone from all five catalogs, with seven new strings each; the hyphen test has
  no exception for dates, and a new test refuses a date written `YYYY-MM-DD` in any language.
- The phone flows choose dates through `subflows/choose-date.yaml` (field and day passed with
  `env`); the trip builder passes `PASSPORT_EXPIRY` from the runners as before.

Checks run:

- `@suskii/ui-native`: lint, type check, 59 tests (the picker and its value helpers, the token
  guard).
- `@suskii/i18n`: 52 tests (the catalogs, the new date test in every language).
- `@suskii/mobile`: lint, type check, 366 tests (53 suites), the accessibility source guard
  included; new tests for a transfer's arrival time and a ride booked for later.
- `maestro check-syntax` (2.11.0, the version CI pins) on every flow and subflow.

Not run here: the Maestro flows themselves, which need the Android emulator of the `mobile`
workflow; no flow covers rentals, rides or driver mode (`docs/phases/backlog.md`), so those
pickers are covered by the Jest screen tests only.
