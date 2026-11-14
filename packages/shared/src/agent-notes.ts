/**
 * The notes a tool can attach to its result (ADR-107). A note is a code, never a sentence: the
 * clients hold the words in every language, so what a traveller is told with an answer does
 * not depend on how a model worded it. A tool whose facts need one returns it with them, and
 * the graph never drops it.
 */
export const AGENT_CARD_NOTES = [
  // Fares already found, compared with earlier ones: a trend, never a forecast.
  'fare_trend',
  // Passport validity is a general reminder: the destination decides who may enter.
  'passport_reminder',
  // Visa rules are guidance from Suskii's own notes: never a guarantee of a visa or of entry.
  'visa_guidance',
  // A booking the assistant prepared (ADR-109): nothing is booked or paid until the traveller
  // enters the details and pays on the booking page.
  'booking_handoff',
  // After a flight was prepared: the assistant can find a stay, a car or a transfer for it.
  'other_services',
  // A bus trip the assistant found (ADR-117): the seats are chosen on its seat map, and nothing
  // is held or booked until the traveller has chosen them and paid.
  'choose_seats',
  // A combined trip the assistant put together (ADR-117): each part takes the travellers'
  // details from the trip page, then one payment covers every part. Nothing is booked before.
  'trip_handoff',
  // One payment for several parts needs an account: sign in, or book each part from its card.
  'trip_sign_in',
  // What a combined trip does not take (packages, tours, visa assistance, eSIMs, lounges) is
  // booked and paid on its own page.
  'trip_separate',
] as const;
export type AgentCardNote = (typeof AGENT_CARD_NOTES)[number];

export const isAgentCardNote = (value: string): value is AgentCardNote =>
  (AGENT_CARD_NOTES as readonly string[]).includes(value);
