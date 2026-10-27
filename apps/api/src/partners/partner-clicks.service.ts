import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { AffiliateNetwork } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import type { ClientContext } from '../search/client-context';
import { partnerClicks } from '../telemetry/metrics';

import { AffiliateLinker } from './affiliate-linker';
import { PartnerLinks } from './partner-links';
import { allowedDestination, partnerProgram, type PartnerProgram } from './partner-programs';

/**
 * The outbound redirect (ADR-070): opens a sealed offer link, records the click and returns the
 * partner URL to send the traveller to. Clicks hold ids only.
 */
@Injectable()
export class PartnerClicksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: PartnerLinks,
    private readonly linker: AffiliateLinker,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The partner URL for a token; 404 for a token we did not seal or a destination off its hosts. */
  async follow(token: string, client: ClientContext): Promise<string> {
    const claims = this.links.open(token);
    const program = claims ? partnerProgram(claims.programId) : undefined;
    // Even a valid token only ever leads to its programme's own hosts (no open redirect).
    if (!claims || !program || !allowedDestination(program, claims.url)) {
      throw new NotFoundException();
    }
    const network = this.network(program);
    const id = uuidv7();
    // An expired link still reaches the partner (the commission is ours), but no longer
    // carries the person or the booking it was shown to.
    await this.prisma.partnerClick.create({
      data: {
        id,
        programId: program.id,
        category: program.category,
        network,
        userId: claims.fresh ? claims.userId : null,
        bookingId: claims.fresh ? claims.bookingId : null,
        channel: claims.channel ?? client.channel,
        campaign: claims.campaign,
      },
    });
    const link =
      program.network === 'travelpayouts'
        ? await this.linker.link(program, claims.url, id)
        : { url: claims.url, tracked: true };
    partnerClicks.add(1, {
      program: program.id,
      network,
      link: link.tracked ? 'tracked' : 'fallback',
    });
    return link.url;
  }

  private network(program: PartnerProgram): AffiliateNetwork {
    if (program.network === 'travelpayouts') return this.linker.network;
    return this.config.ACTIVITY_PARTNER === 'viator' ? 'viator' : 'mock';
  }
}
