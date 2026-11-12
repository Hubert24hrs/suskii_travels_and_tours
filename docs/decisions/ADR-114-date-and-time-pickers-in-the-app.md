# ADR-114: Date and time pickers in the app

- Status: Accepted
- Date: 2026-11-12
- Deciders: the owner (asked for pickers in place of the typed dates, the change ADR-109 left
  for later), Claude Code (implementer)
- Amends: ADR-109 (plain copy: the typed dates were its one exception besides French and
  Portuguese spelling)

## Context

Twelve fields in the app took a date (`2026-12-01`) or a date and a wall time
(`2026-12-01T14:30`) as typed text, under a hint that showed that form:

- at checkout, each traveller's date of birth and passport expiry, and an airport transfer's
  arrival time;
- for a rental, the pickup and the return on the search and on a car, and the driving licence's
  expiry after booking;
- a ride booked for later;
- in driver mode, the driver's date of birth, the licence's expiry and a vehicle's insurance
  expiry.

The hint was the last place a customer read a hyphen (ADR-109), and typing invited mistakes
(the order of day and month, a missing zero) that only the API caught. The website uses the
browser's own date fields; the app's one calendar, `DateRangePicker`, is a run of months from
today: right for travel dates, useless for a birth year decades back.

## Decision

### One picker in ui-native, with no native module

`DatePicker` (`packages/ui-native/src/components/date-picker.tsx`) is a field (`FieldButton`) that
opens the bottom sheet every other picker uses (`Sheet`). `mode` is `date` or `dateTime`.

- **Three panes.** The years, four to a row, start at the end of the range nearer today: the
  newest first for a date of birth, the soonest first for an expiry date; the list opens at the
  year on show. A year opens its twelve months; a month opens its days, with previous and next
  and a title that opens the years again. Any date of birth is a year, a month and a day.
- **The time, on the 24 hour clock.** In `dateTime` mode the hours `00` to `23` and the minutes
  every five are chips under the days, each a radio group. An hour alone is on the hour. A
  minute off the step (a ride suggested from an instant, `14:37`) is shown as it is and never
  rounded. A rental's day takes 10:00 until another time is chosen, the form's old default.
- **Done keeps the value.** The sheet holds a draft; Done turns it into the value and is
  disabled until the value is complete; closing the sheet keeps the old value. A line at the top
  of the sheet says what Done will keep and is announced as it changes.
- **The value does not change.** The screens hold and send the same ISO strings as before:
  `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. Nothing in the API, the schemas or the generated client
  changed.
- **Shown in words.** The field shows `format.date(value, 'medium')`, and a wall time as the app
  shows times elsewhere: the date in words and the 24 hour time ("5 Dec 2026 14:35"). Month,
  weekday and day names come from Intl in the app's Latin-digit locale (`intlLocale`). Arabic
  mirrors with the layout, and the previous and next arrows are chosen by `I18nManager.isRTL`.
- **Test ids.** The field; `{testID}-sheet`, `-value`, `-done`; `-years` (the title that opens the
  years), `-previous`, `-next`; `-year-YYYY`, `-month-YYYY-MM`, `-day-YYYY-MM-DD`, `-hour-HH` and
  `-minute-MM`.

The app wraps it as `DateField` and `DateTimeField` (`apps/mobile/src/components/date-field.tsx`),
which bring the catalog's words, the locale and the formatting. The four hints are gone from
every catalog, and the catalog test that refused hyphens in English no longer excuses a date's
form; a new test refuses a date written `YYYY-MM-DD` in any language.

### What each field offers

The bounds only shape the picker. The API checks every value as it did (lead times, horizons,
ages, an expiry against the trip).

| Field                                   | First day                                                        | Last day                                                                          |
| --------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Date of birth (traveller, driver)       | 120 years back                                                   | today                                                                             |
| Passport expiry                         | today                                                            | 20 years ahead (passports run ten years)                                          |
| Driving licence expiry (rental, driver) | today                                                            | 50 years ahead (some licences run to the holder's seventieth birthday)            |
| Vehicle insurance expiry                | today                                                            | 10 years ahead                                                                    |
| Rental pickup on the search             | today on the earliest calendar on Earth (`earliestToday()`)      | 180 days ahead, the API's default `RENTAL_MAX_ADVANCE_DAYS`                       |
| Rental pickup on a car                  | today where the car is (`todayIn(vehicle.timeZone)`)             | the same                                                                          |
| Rental return                           | the pickup's day                                                 | the last pickup day plus `RENTAL_MAX_DAYS`                                        |
| Ride for later                          | today on the phone (the time is the phone's, sent as an instant) | 7 days ahead, the API's default `RIDE_SCHEDULE_MAX_DAYS`, which its message names |
| Airport transfer's arrival              | the transfer's first day less one, never before today anywhere   | its last day plus one (a late flight lands after midnight)                        |

The search form knows no car yet, so its first day is the date in the zone that is always
earliest: no day that is still today where a car waits is closed (ADR-097's rule for "today").

### Why no native picker

A native module (`@react-native-community/datetimepicker`) was weighed and refused:

- Android's dialogs follow the phone's 12 or 24 hour setting; the owner asked for the 24 hour
  form everywhere.
- A system dialog sits outside the app's test ids: Maestro would tap by text or position, which
  changes with the Android version and the language.
- It is a new native dependency through prebuild and the trust policy (ADR-055), for a look
  and a right to left layout that are the system's rather than the design tokens'.

The picker in JavaScript reuses the sheet, the tokens and the test id scheme of the other
pickers, and runs in Jest. No native module was added, so the Android build is unchanged.

## Consequences

- No customer reads a date in the form a machine reads, and nothing about a date can be typed
  wrong. ADR-109's exception for typed dates is gone.
- A date of birth takes a year, a month, a day and Done (and a scroll through the years) where it
  took ten characters: slower for a fast typist, but nothing to learn and nothing to misread.
- In `dateTime` mode the sheet scrolls: 36 time chips sit under the days.
- The rental and ride horizons in `lib/cars.ts` follow the API's defaults. A server with other
  settings still refuses what it does not take, with the message it always gave; change the
  constants with the settings.
- App tests choose dates the way a person does (`chooseDate()` in `src/test/app.tsx`), and a test
  that picks fixed days pins the phone's date (`pinClock()`, which fakes `Date` only). Phone flows
  choose dates through `e2e/maestro/subflows/choose-date.yaml`.

## Alternatives considered

- **A native date picker module.** Refused, above.
- **A text field with a mask (`__/__/____`).** Still typing, still a form to learn, and the order
  of day and month differs by country.
- **Wheels (spinners) in JavaScript.** Driven by gestures: harder to use with a screen reader and
  to drive from Maestro.
- **The range calendar's run of months.** A birth date in 1960 is nearly 800 months back.
