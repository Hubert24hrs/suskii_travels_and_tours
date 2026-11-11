/**
 * Limits of the assistant a client needs before it sends anything. Kept apart from `agent.ts`
 * so the website's small entry (`@suskii/shared/lite`) can carry them without the catalogue.
 */

/** The longest message a traveller or a staff member may send. */
export const AGENT_MESSAGE_MAX = 2000;
