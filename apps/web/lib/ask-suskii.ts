import { randomInt } from 'node:crypto';

/** The places the "Ask Suskii" button rests in; `globals.css` has one rule for each. */
export const ASK_SUSKII_PLACES = 4;

/** Where the button starts on this visit: a different place from one page load to the next. */
export const askSuskiiStart = (): number => randomInt(ASK_SUSKII_PLACES);
