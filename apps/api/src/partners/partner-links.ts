import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { partnerLinkContext } from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';
import type { SalesChannel } from '../generated/prisma/client';

/** Envelopes are a few hundred characters; anything far longer is not one of ours. */
const MAX_TOKEN_LENGTH = 2048;
const HOUR_MS = 3_600_000;

export interface PartnerLinkClaims {
  programId: string;
  /** The partner page or product the traveller chose. */
  url: string;
  /** Who saw the offer (the redirect itself runs in a browser without a session). */
  userId: string | null;
  channel: SalesChannel | null;
  /** The booking the offer was shown with (cross-sell). */
  bookingId: string | null;
  campaign: string | null;
}

export interface OpenedPartnerLink extends PartnerLinkClaims {
  /** False once the link is older than PARTNER_LINK_TTL_HOURS. */
  fresh: boolean;
}

const sealedSchema = z.object({
  p: z.string().min(1).max(40),
  u: z.string().min(1).max(1500),
  uid: z.uuid().nullable(),
  ch: z.enum(['web', 'mobile']).nullable(),
  b: z.uuid().nullable(),
  c: z.string().max(64).nullable(),
  e: z.number().int().positive(),
});

/**
 * Offer links (ADR-070): AES-256-GCM envelopes of the programme, destination, viewer and expiry.
 * Sealed, so the user id never appears in a readable URL and no field can be altered.
 */
@Injectable()
export class PartnerLinks {
  constructor(
    private readonly encryption: FieldEncryption,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The API path a client opens (in the system browser on the app). */
  href(claims: PartnerLinkClaims, now = Date.now()): string {
    return `/v1/go/${this.seal(claims, now)}`;
  }

  seal(claims: PartnerLinkClaims, now = Date.now()): string {
    const payload: z.infer<typeof sealedSchema> = {
      p: claims.programId,
      u: claims.url,
      uid: claims.userId,
      ch: claims.channel,
      b: claims.bookingId,
      c: claims.campaign,
      e: now + this.config.PARTNER_LINK_TTL_HOURS * HOUR_MS,
    };
    return this.encryption.encrypt(JSON.stringify(payload), partnerLinkContext());
  }

  /** The claims of an authentic token, or null when it was altered, truncated or forged. */
  open(token: string, now = Date.now()): OpenedPartnerLink | null {
    if (token.length > MAX_TOKEN_LENGTH) return null;
    let parsed: z.infer<typeof sealedSchema>;
    try {
      const result = sealedSchema.safeParse(
        JSON.parse(this.encryption.decrypt(token, partnerLinkContext())),
      );
      if (!result.success) return null;
      parsed = result.data;
    } catch {
      return null;
    }
    return {
      programId: parsed.p,
      url: parsed.u,
      userId: parsed.uid,
      channel: parsed.ch,
      bookingId: parsed.b,
      campaign: parsed.c,
      fresh: parsed.e > now,
    };
  }
}
