# ADR-121: The Ask Suskii chat in the app: its own header, a message box on the keyboard, cards that open the app, and no score

- Status: Accepted
- Date: 2026-11-15
- Deciders: the owner (asked for a modern chat screen after trying it on a phone, and for the score
  out of five to go), Claude Code (implementer)
- Amends: ADR-109 (Ask Suskii), ADR-106 (the conversation's score)

## Context

The owner used Ask Suskii in the test app against the testing backend and reported four problems.

1. **The message being typed disappeared under the keyboard.** The whole chat was one scroll view
   with the message box in the middle, and the box grew with every line. React Native 0.86 draws
   Android edge to edge, so the keyboard covers the screen instead of resizing it, and nothing
   kept the growing box in view.
2. **A card named "Home" opened the website in a browser tab** (and Chrome's own Google sign-in
   prompt first). The card checked the app's list of incoming links, whose answer for a page it
   does not know is `/`, and read `/` as "no screen of its own". So the home page itself, and
   `/support`, `/account`, `/prime`, `/trips` and others, always went to the browser.
3. **Start a new conversation did not clear the chat.** The app's query cache keeps answers fresh
   for 30 seconds. The button cleared the answer to "which conversation is open" under one cache
   key only; opened from History, the screen read another key, and the old chat came straight back.
4. **"How well did the assistant help?"** with five buttons sat under every answered
   conversation. The owner did not want it.

Two of the guide's cards were also broken on both clients: "Sign in" pointed at `/sign in` and
"Travel extras" at `/travel-extras`. Plain copy keeps hyphens out of words, not out of addresses.

## Decision

1. **The chat screen draws its own header**: the way back, Ask Suskii's mark and name, Earlier
   conversations (signed in) and New chat (once a conversation exists). The native header is hidden
   on this screen, so the actions are always in reach and tested like the rest of the screen.
2. **The message box sits on the keyboard.** The screen is a `KeyboardAvoidingView` with `padding`
   on both platforms. It pads by however much the keyboard overlaps it, which is the keyboard's
   height on an edge-to-edge Android and nothing where the system already resized the window. The
   box grows to about four lines (a named size, `composer`, 136 px) and then scrolls inside itself.
   The conversation keeps its newest message in view, also when the keyboard opens. Talk to a
   person and the assistant's preferences stay in reach above the box; the privacy line stays under
   it.
3. **Messages are bubbles**: the traveller's on the reading end, Ask Suskii's facing them with its
   mark, three dots while it answers (still under "reduce motion"). Before the first message the
   screen says what Ask Suskii does, says it is automated, and offers four questions a tap sends as
   they are. Each answer keeps its thumbs, as icons.
4. **Cards open the app.** `assistantCardTarget()` (`apps/mobile/src/lib/assistant.ts`) maps every
   page the app has a screen for: Home (also for `/flights` and `/hotels`, whose forms are Home's
   tabs), deals, Prime, account, the trip planner, bookings, support, price requests, searches,
   buses, rides, rentals (with the dates a card carries), packages and tours. Only a page the app
   lacks (visa products, travel extras, route pages) opens on the website. Anything that is not a
   path of the site is no link at all.
5. **New chat clears every cached answer** to which conversation is open, whatever key the screen
   was opened with, before it clears what the device remembers. The old conversation stays the
   account's, in History.
6. **No score out of five** on the app or the website. The API's rating route stays for app builds
   already on phones; the console's quality page keeps the scores given so far.
7. **The guide names real pages**: `/sign-in` and `/travel-add-ons`, and a spec checks every page
   the guide names against the website's own pages.

## Consequences

- The chat works with the keyboard on every Android phone the app supports, whatever its
  navigation bar, without a new native library.
- A traveller stays in the app when Ask Suskii points somewhere: the website opens only for the
  few pages the app does not have.
- Staff get no new conversation scores; the per-answer thumbs and the funnel remain the signal.
- The website's chat keeps its layout; only the score left it.

## Alternatives considered

- **`react-native-keyboard-controller`.** It is the library Reanimated now points to, but it is a
  new native dependency; React Native's own `KeyboardAvoidingView` already measures the overlap.
- **Reanimated's `useAnimatedKeyboard`.** It works, but Reanimated 4 deprecates it.
- **Buttons in the native header.** The test setup draws no native header, so New chat, the
  button that had failed, could not be tested there.
