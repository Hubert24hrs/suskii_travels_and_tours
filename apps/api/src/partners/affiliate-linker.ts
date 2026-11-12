import type { AffiliateNetwork } from '../generated/prisma/client';

import type { PartnerProgram } from './partner-programs';

export interface TrackedLink {
  url: string;
  /** False when the network could not make a tracked link and the traveller goes untracked. */
  tracked: boolean;
}

/**
 * Turns a partner page into a link that credits Suskii and carries our click id, so the
 * network's conversion report names the click (ADR-070). Never throws: a click must never be lost
 * to a network outage, so failures fall back to the plain partner page.
 */
export abstract class AffiliateLinker {
  abstract readonly network: Exclude<AffiliateNetwork, 'viator'>;
  abstract link(
    program: PartnerProgram,
    destination: string,
    clickId: string,
  ): Promise<TrackedLink>;
}

/** Tests and local stacks: the partner page with the click id, so tests can follow it. */
export class MockAffiliateLinker extends AffiliateLinker {
  readonly network = 'mock' as const;

  link(_program: PartnerProgram, destination: string, clickId: string): Promise<TrackedLink> {
    const url = new URL(destination);
    url.searchParams.set('sub_id', clickId);
    return Promise.resolve({ url: url.toString(), tracked: true });
  }
}
