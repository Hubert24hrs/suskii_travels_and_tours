# ADR-108: The sign-in card, "Remember me", search bars over known places and stable city ids

- Status: Accepted
- Date: 2026-11-12
- Deciders: the owner (sent reference pictures and a list of changes after trying the test app
  on a phone), Claude Code (implementer)
- Amends: ADR-007 and ADR-037 (session lifetimes), ADR-067 (where Google, Apple and the
  fingerprint button sit), ADR-061 (the flight form no longer offers "Describe your trip"),
  ADR-053 (how a traveller picks a place we serve), ADR-097 (ids kept on a device)

## Context

The owner tried the test app and asked for five things:

1. Sign in laid out like a reference picture: one card with "Welcome back", the email and the
   password with an eye to show it, "Remember me" on the left and "Forgot password?" on the
   right, a wide Sign in button, "or continue with" and Google and Apple side by side, then
   "Create account". Fingerprint sign-in must stay available once an account exists.
2. On Home, after a hotel search and a visit to another section, "Continue your search", the
   destination field and Search "did not work any more".
3. A bar to type the city into on the bus form's From and To.
4. The same for a ride's pick-up and drop-off.
5. No "Describe your trip" on the flight form: one assistant for the whole platform instead
   (Ask Suskii, ADR-109).

## Decision

### The sign-in card

The website's `/sign-in` and the app's Sign in screen are one card in that order, in SUSKII
T&T's own colours and type (the reference's purple is not ours). The card carries its own
heading, so the page around it has none. The email and phone tabs became one line under the
card ("Use your mobile number instead"), so the card reads as the reference does and a texted
code is still one tap away.

- **Show password.** An eye inside the password field shows what was typed and hides it again.
  It is a button with its own name ("Show password", "Hide password"), reached by keyboard.
- **Google and Apple** sit side by side under "or continue with", each with the provider's own
  mark and its name. A screen reader hears the full wording ("Continue with Google"). The marks
  are the providers' own, in their own colours, kept as image files that
  `scripts/brand-assets.mjs` copies from `brand/providers/`: no component holds a colour of
  theirs, which the token rules forbid. Register keeps its two full-width buttons at the top.
- **Fingerprint** (app): the button stays on the card, under Sign in, always shown; until this
  phone has a credential a press says how to turn it on (ADR-067, unchanged).
- **Forgot password?** opens the website's reset page, in the system browser from the app: the
  reset link is emailed and opens on the website, so the request starts there too.

### "Remember me" is real

A box that changed nothing would be a false control, so it decides how long the sign-in lasts.
It is ticked to start with, which is how every sign-in behaved before.

|                 | Ticked (as before)                                         | Unticked                                           |
| --------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| API session     | 90 days at most, 30 days idle                              | 24 hours at most (`UNREMEMBERED_SESSION_HOURS`)    |
| Website cookies | carry a lifetime                                           | no lifetime: the browser drops them when it closes |
| App             | tokens in the secure store, profile in the encrypted cache | tokens and profile in memory only                  |

- The sign-in routes (`login`, `mfa/verify`, `otp/verify`, `google`, `apple`) take an optional
  `remember`. Left out it is true, so older app builds and every other caller behave as before.
- The choice is a column on the session (`sessions.remembered`), so a refresh sets cookies the
  same way the sign-in did. A staff session is never made longer by it: the shorter of the two
  limits applies.
- In the app a session that is not remembered writes nothing of itself to the phone. If the app
  closes on it, the next start finds no session, and clears what the account kept on the phone
  (trips, documents, cached answers), exactly as a sign-out does. A marker in the settings
  store says that such a session was running; it holds nothing of the session.
- Under the box, while it is unticked, one line says what that means.

The 24 hours are a constant beside the 90 days, not a setting: nobody has asked to tune it,
and one more setting is one more thing to get wrong.

### Search bars over the places we serve

The bus form's From and To and the ride form's pick-up and drop-off each get a search bar over
their chips (`SearchableChips`). Typing narrows the chips, whatever the case or the accents; a
name typed in full is chosen without a tap; the keyboard's search key takes the only place
left; a chip fills the bar. Nothing typed is sent anywhere: the list stays the cities and
places we serve (ADR-053), and a name that matches none says so.

### The flight form without "Describe your trip"

The website and the app no longer show the box or load its code, and its strings left the
catalogs. The API route stays: app builds already on phones still call it, and it is off in
production unless `AI_SEARCH_ENABLED` is set. The eval and its tests stay with the route.

### The hotel form after a search: what was found

The phone flow written for the report (`hotel-return.yaml`: search, leave by the bottom tabs
and by the search card's tabs, then use the shortcut, the field and Search) passed on the
emulator, so those steps do not freeze the form there. Reading for what could differ on the
owner's phone found two real defects, and both are fixed:

- **A city's id was different in every database.** Cities were seeded with random ids. The
  app keeps a city id for "Continue your search", and the hosted test server is rebuilt with a
  new database every four hours (ADR-092): a new one started while the owner was testing. A
  shortcut kept from the earlier server then named a city the new one did not know, and the
  results screen could only say "We could not load results" with a Retry that could never
  work. Cities are now seeded with an id derived from their country and name
  (`stableCityId`, an RFC 9562 name-based UUID), the same in every database. A city already
  seeded keeps its id. And when the API does say it does not know a city, the app drops that
  shortcut and says "We could not find that place any more", once, with the way back.
- **The form forgot what was typed.** Home shows one search form at a time, so opening
  another tab took the hotel form down, and it came back empty: Search then answered with
  "choose a destination". The form now keeps its destination, dates and rooms in memory while
  the app runs, until the check-in day has passed.

If the form still does nothing on the owner's phone with the new test app, the exact steps and
the phone's model are needed: nothing in the code or on the emulator shows a third cause.

## Consequences

- **An API contract change, additive.** `remember` is optional on five request bodies. No
  response changed. Older app builds are unaffected.
- **One more session rule** to keep in `docs/security/authentication.md`.
- **A sign-in that is not remembered still exists on the server for up to a day** after a
  browser or the app is closed, because nothing tells the server. Its tokens are gone from the
  device, and the session list shows it and can end it.
- **Apple's rules for its button.** Apple's guidelines name the titles a Sign in with Apple
  button may carry. A button that shows the mark and "Apple" is a custom one: before the App
  Store submission it must be checked against the guidelines in force, and changed to an
  approved title or to the mark alone if review asks. Android and the website are not bound by
  that. This is an owner item for the store release.
- **City ids are now a function of country and name.** Renaming a city in the reference data
  would give it a new id on a fresh database; an existing database keeps the row it has.
- **The website's "Continue your search"** keeps city ids in the browser the same way. Stable
  ids remove the cause there too; the website still shows its general error for a city the API
  does not know, which no longer happens between rebuilt test servers.
