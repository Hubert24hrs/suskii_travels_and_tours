# Screen reader checklist

Automated checks catch missing labels and contrast. They include axe on every ui-web story and
on the web and admin e2e pages, plus React Native Testing Library role queries. They cannot tell
whether a journey makes sense when heard. Run this checklist before each store release and
before any release that changes search, checkout or sign-in.

## Set-up

| Platform           | Screen reader | Browser or app                    | Turn on                                                              |
| ------------------ | ------------- | --------------------------------- | -------------------------------------------------------------------- |
| iPhone             | VoiceOver     | Safari, and the iOS app           | Settings, Accessibility, VoiceOver (or triple-click the side button) |
| Android phone      | TalkBack      | Chrome, and the Android app       | Settings, Accessibility, TalkBack (or hold both volume keys)         |
| Mac                | VoiceOver     | Safari: website and admin console | Cmd + F5                                                             |
| Windows (optional) | NVDA          | Firefox or Chrome                 | Ctrl + Alt + N                                                       |

Use the staging stack with sample data (`db:seed:demo`), mock payments, and a test account with
an authenticator. Set the device to the largest text size for one pass, and test with the
screen curtain on (VoiceOver: triple-tap with three fingers) for another.

## Every screen

- [ ] The page or screen title is announced on arrival, and focus starts at the top or at the
      main heading.
- [ ] Headings form an outline. Rotor or reading controls can jump between headings,
      landmarks and form fields.
- [ ] Every button, link, icon and image has a name that says what it does ("Swap origin and
      destination", not "button"). Decorative images are silent.
- [ ] Prices are read as currency, such as "₦250,000" read as naira, never as digits.
- [ ] Dates are read in full ("Friday 14 November"), and times include the airport time zone
      where the screen shows it.
- [ ] Nothing important appears only as colour, position or an icon. "Sample" badges and
      price changes are announced.
- [ ] Toasts and status changes (loading, saved, errors) are announced once, without moving
      focus unexpectedly.
- [ ] Dialogs and bottom sheets: focus moves into them, stays there, and returns to the
      control that opened them. Escape or the back gesture closes them.
- [ ] At the largest text size nothing is cut off, overlaps, or needs horizontal scrolling.

## Journeys

### Search (web homepage and app search tab)

- [ ] The vertical tabs (Flights, Hotels, Packages, ...) are announced as tabs with the
      selected one.
- [ ] The origin and destination comboboxes announce the suggestion count, and the arrow keys
      or swipes read each option. Choosing one announces the selection.
- [ ] The date picker announces month and day, unavailable dates are marked, and the chosen
      range is read back.
- [ ] Travellers: steppers announce their value and limits ("Adults, 2, minimum 1").
- [ ] Search errors (same origin and destination, dates in the past) are read when submitting,
      and focus goes to the first field with an error.

### Results and details

- [ ] The result count and "partial results" notices are announced after loading.
- [ ] Each flight card reads in a useful order: price, airline, times, duration, stops,
      baggage.
- [ ] Filters and sort announce their state, and the result count updates are announced.
- [ ] Hotel details: the gallery has labels, and room options read price and cancellation
      terms.

### Checkout and payment

- [ ] Passenger forms: each field has a label and its format hint (passport expiry, date of
      birth). Required fields are announced as required.
- [ ] Validation errors are read in a summary and next to each field, and focus moves to the
      first one.
- [ ] Price change consent: the old and new totals are read, and both choices are clear.
- [ ] Payment options: the plan schedule, fee and missed-payment policy are read before
      committing.
- [ ] The hand-off to the provider's page is announced. On return, the booking status (paid,
      waiting for confirmation) is announced.

### Trips and documents

- [ ] The booking page reads the status, reference and itinerary in order.
- [ ] Download buttons name the document ("Download e-ticket, PDF").
- [ ] App: offline trips are announced as offline copies with their last update time.

### Account and sign-in

- [ ] Sign-in errors are generic and announced. The password visibility toggle states whether
      the password is shown.
- [ ] MFA: the code field is announced as a one-time code. The QR code during enrolment has a
      text alternative (the secret key, readable letter by letter).
- [ ] Account deletion and data export explain the re-authentication step before asking.

### Admin console (VoiceOver on Mac)

- [ ] The navigation lists only the sections the role can open, and the current section is
      announced.
- [ ] Tables have column headers, and row actions name the row ("Approve refund RF-…").
- [ ] Step-up prompts announce why they appear, and focus moves to the code field.
- [ ] Destructive confirmations read the consequence before the confirm button.

## Recording results

Record each run below. File an issue for each failure with the platform, screen, steps, and
what was announced compared with what was expected. A failure in search, checkout, payment or
sign-in blocks the release.

| Date | Build or commit | Platforms tested | Tester | Failures (issue links) |
| ---- | --------------- | ---------------- | ------ | ---------------------- |
|      |                 |                  |        |                        |

The first run needs a person with the devices. It is an owner action before the first store
release (phase 12).
