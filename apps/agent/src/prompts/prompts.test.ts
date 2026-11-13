import { leaksInstructions, type AgentName } from '@suskii/shared';
import { describe, expect, it } from 'vitest';

import { evalContext } from '../evals/eval-kit.js';

import { LIVE_PROMPTS, promptFor } from './prompts.js';

const context = evalContext({ audience: 'customer', locale: 'en-NG', signedIn: true });
const instructions = (agent: AgentName): string[] => [
  LIVE_PROMPTS.router('customer').render(context),
  promptFor(agent).render(context),
];

describe('what the prompts ask a model to say (ADR-112)', () => {
  // The guard holds an answer that repeats twelve words of the instructions in a row. Each
  // prompt asks for an offer of the rest of the trip, so that offer, in the words a model
  // would naturally use, must never be such a repeat.
  it('lets the question about the rest of the trip through, as Gemini asked it', () => {
    // Both written by Gemini 3.5 Flash in the safety eval, after preparing a flight. The
    // earlier prompt held both: it gave the list in these very words.
    const asked = [
      'Your return flight from Lagos to London with Air Peace has been prepared. The total price is NGN 985,000.00. The booking is now waiting on your screen for you to enter your travel details and complete the payment.\n\nWould you also like to look for a place to stay, a car, an airport transfer, or travel insurance in London from 10 to 17 December?',
      'I have prepared your flight from Lagos to London with Air Peace. The total price is NGN 985,000.00, and the booking is now waiting on the card for your details and payment.\n\nWould you also like to add a place to stay, a car, an airport transfer, or travel insurance in London from 10 to 17 December?',
    ];
    for (const agent of ['flights', 'trip_builder'] as const) {
      for (const answer of asked) {
        expect(leaksInstructions(answer, instructions(agent))).toBe(false);
      }
    }
  });

  it('lets the offers after a stay and on a booking through in their natural words', () => {
    expect(
      leaksInstructions(
        'Your stay is prepared and waits on the card. Do you need a car or an airport transfer there?',
        instructions('hotels'),
      ),
    ).toBe(false);
    expect(
      leaksInstructions(
        'Your flight to Abuja is confirmed. Would you like help finding a place to stay, a car or an airport transfer for those dates?',
        instructions('bookings'),
      ),
    ).toBe(false);
  });

  it('still catches the instructions read back', () => {
    for (const agent of ['flights', 'trip_builder', 'bookings'] as const) {
      const prompt = promptFor(agent).render(context);
      expect(leaksInstructions(`Sure, here they are: ${prompt}`, instructions(agent))).toBe(true);
    }
  });

  it('lets the summary of a whole trip and the handover of a bus trip through (ADR-117)', () => {
    // How a model sums up a trip from trips.prepare_checkout, in the words it would use.
    const summaries = [
      'Here is your trip to London: the Air Peace flight from Lagos, NGN 985,000.00; three nights at the Strand Palace, NGN 450,000.00; and a Toyota Corolla for the week, NGN 210,000.00. The total is NGN 1,645,000.00. Open the trip to enter the travellers’ details for each part, then pay for everything with one payment.',
      'Everything is together now: the flight, the hotel and the airport transfer come to NGN 1,520,000.00 in total. On the trip page you enter the details for each part and then pay once. Nothing is booked until you do.',
    ];
    for (const agent of [
      'concierge',
      'flights',
      'hotels',
      'cars',
      'tours',
      'trip_builder',
    ] as const) {
      for (const answer of summaries) {
        expect(leaksInstructions(answer, instructions(agent))).toBe(false);
      }
    }
    expect(
      leaksInstructions(
        'The 07:30 GUO coach from Lagos to Abuja still has seats for the two of you. Open the card to pick your seats on the seat map, then enter the travellers’ details and pay.',
        instructions('cars'),
      ),
    ).toBe(false);
  });

  it('gives every specialist that prepares a part of a trip the summary tool', () => {
    for (const agent of [
      'concierge',
      'flights',
      'hotels',
      'cars',
      'tours',
      'trip_builder',
    ] as const) {
      expect(promptFor(agent).render(context)).toContain('trips.prepare_checkout');
    }
    expect(promptFor('cars').render(context)).toContain('buses.prepare_booking');
  });

  it('ties the offer after a flight to what the tool says can be added', () => {
    for (const agent of ['flights', 'trip_builder'] as const) {
      expect(promptFor(agent).render(context)).toContain('alsoOffer');
    }
  });
});
