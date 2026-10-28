import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Role } from '@suskii/shared';

/**
 * Staff and customer accounts the global setup creates through the API. Each test signs in as
 * its own persona: the API refuses a TOTP code that was already used, so two tests signing in
 * the same account in one 30-second step would fail each other.
 */
export const PERSONAS = {
  /** Has no authenticator yet: enrols on first sign-in. */
  enrol: { roles: ['content_manager'], enrolled: false },
  /** Mistypes the code, then signs in and out. */
  mfa: { roles: ['support'], enrolled: true },
  /** No staff role. */
  customer: { roles: [], enrolled: false },
  /** Requests the refund. */
  support: { roles: ['support'], enrolled: true },
  /** Approves the refund (maker-checker). */
  finance: { roles: ['finance'], enrolled: true },
  /** Adds the markup rule. */
  pricing: { roles: ['finance'], enrolled: true },
  /** Adds the tax rule. */
  taxes: { roles: ['finance'], enrolled: true },
  /** Creates the promo code; cannot see pricing or the audit log. */
  operations: { roles: ['operations'], enrolled: true },
  /** Verifies the trust signal (super admins only). */
  verifier: { roles: ['super_admin'], enrolled: true },
  /** Reads the audit log after the other journeys. */
  auditor: { roles: ['super_admin'], enrolled: true },
  /** Opens every page for the accessibility checks. */
  axe: { roles: ['super_admin'], enrolled: true },
  /** Uses the console at phone width. */
  phone: { roles: ['support'], enrolled: true },
  /** Signs the target out everywhere, then disables it after a fresh authenticator code. */
  stepUp: { roles: ['super_admin'], enrolled: true },
  /** A customer the step-up persona signs out and disables. */
  target: { roles: [], enrolled: false },
  /** Releases the payment the risk review held (ADR-040). */
  riskReviewer: { roles: ['finance'], enrolled: true },
  /** Applies to drive through the API (Cars, ADR-050). */
  applicant: { roles: [], enrolled: false },
  /** Reviews the applicant's documents and vehicle, then approves the driver. */
  driverReviewer: { roles: ['operations'], enrolled: true },
  /** Publishes the traveller's review of a finished tour (ADR-077). */
  reviewModerator: { roles: ['content_manager'], enrolled: true },
  /** A customer who created a company through the API (ADR-078). */
  companyOwner: { roles: [], enrolled: false },
  /** Suspends and reinstates the company (step-up). */
  companyStaff: { roles: ['super_admin'], enrolled: true },
  /** Adds a metasearch partner and replaces its key (step-up, ADR-081). */
  metasearch: { roles: ['finance'], enrolled: true },
  /** Adds a Suskii Prime plan with a country price (step-up, ADR-082). */
  prime: { roles: ['finance'], enrolled: true },
  /** Answers a traveller's support conversation with a note and a reply (ADR-083). */
  supportAgent: { roles: ['support'], enrolled: true },
  whatsappAgent: { roles: ['support'], enrolled: true },
  /** Opens, updates and resolves a status page incident (ADR-087). */
  statusAgent: { roles: ['operations'], enrolled: true },
} as const satisfies Record<string, { roles: readonly Role[]; enrolled: boolean }>;

export type PersonaKey = keyof typeof PERSONAS;

export interface Persona {
  id: string;
  email: string;
  password: string;
  /** The authenticator setup key, or null when the persona has not enrolled. */
  secret: string | null;
}

export interface StackState {
  personas: Record<PersonaKey, Persona>;
  /** A paid guest tour booking (refund journey). */
  tourBooking: { id: string; reference: string };
  /** A paid tour booking held by the payment risk review. */
  heldBooking: { id: string; reference: string };
  /** A paid visa assistance booking and the application it opened. */
  visa: { bookingId: string; applicationId: string };
  /** The tour whose public price the markup test watches. */
  tourSlug: string;
  /** The applicant's driver profile, documents scanned and waiting for review. */
  driver: { id: string; name: string };
  /** A guest's review of a finished tour, waiting for a moderator (ADR-077). */
  review: { bookingReference: string; subject: string };
  /** A company the company owner created (ADR-078). */
  company: { name: string };
  /** The run's own database, for the few states a browser cannot reach (an aged session). */
  databaseUrl: string;
}

export const STATE_FILE = resolve(__dirname, '../test-results/stack/state.json');
export const LOG_DIR = join(resolve(__dirname, '..'), 'test-results/stack');

export function readState(): StackState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as StackState;
}
