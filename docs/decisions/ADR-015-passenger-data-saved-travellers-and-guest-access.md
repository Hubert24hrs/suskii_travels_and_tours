# ADR-015: Passenger data, saved travellers and guest access

- Status: Accepted
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

Checkout collects the most sensitive data in the product: names as on passports, dates of birth,
passport numbers and contact details. The spec requires name validation against passport rules,
transliteration of non-ASCII names, infant age checked on the return date, a warning for passports
expiring within six months, encrypted passport numbers, no PII in logs, and guest checkout.

## Decisions

### Names

Names are entered as printed in the passport's machine-readable zone. Accented Latin letters are
transliterated (Unicode decomposition, combining marks removed, then `ß` to `SS`, `Æ` to `AE`, `Ø`
to `O`, `Ł` to `L`, `Đ` to `D`, `Þ` to `TH`), upper-cased and spaces collapsed; the result may only
contain A-Z, spaces, hyphens and apostrophes. Other scripts are rejected with a message asking for
the Latin spelling in the passport. Given names and surname are 1-40 characters each and at most 55
together, which fits common airline and GDS limits. The form shows the normalised name before
booking so the traveller can check it.

### Ages and documents

- Adults are 12 or older, children 2-11 and infants under 2 **on the last travel date** (return
  flight or check-out); lap infants never outnumber adults.
- Passport details (number, issuing country, expiry) are required for international itineraries
  and optional for domestic ones. A passport that expires before the last travel date is an error;
  one expiring within six months after it is a warning shown before payment.

### Storage and exposure

- Passport numbers on booking passengers and saved travellers are encrypted with `FieldEncryption`
  and a record-bound context (`booking-passenger:{id}:passport`, `traveller:{id}:passport`).
  Responses return them masked (last three characters).
- Booking contact email and phone are encrypted (`booking:{id}:contact`); an HMAC of the email
  (per-purpose key) supports booking lookup later without decrypting.
- The logger never receives request bodies for these routes; audit metadata holds ids and reason
  codes only.

### Saved travellers

Signed-in users can keep up to 20 travellers (`/v1/me/travellers`). A checkout passenger can
reference a saved traveller; the API copies the encrypted passport server-side, so the full number
never travels back to the browser. "Save this traveller" at checkout creates or updates one.

### Guest access

Guest bookings get a random 256-bit access token, returned once when the booking is created and
stored only as an HMAC. The booking page sends it as `X-Booking-Token`; without it (or ownership
for signed-in users) booking routes answer 404. The web app keeps the token in the tab's session
storage. Guest checkout requires a Turnstile token, like the newsletter.

## Consequences

- Names in unsupported scripts cannot be booked until the traveller enters the passport's Latin
  spelling, which is what airlines require anyway.
- A guest who closes the tab relies on the confirmation email until booking lookup (reference, last
  name and email OTP) ships with accounts in phase 9.
