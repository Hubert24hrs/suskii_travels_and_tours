import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { CABIN_CLASSES, money, type FlightSearchRequest, type Money } from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { metasearchLinkContext } from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';

const HOUR_MS = 3_600_000;
/** Sealed links are well under a kilobyte; anything far longer is not one of ours. */
const MAX_TOKEN_LENGTH = 2048;

/** Partner API keys (ADR-081): `smk_` and 32 random bytes in base64url. */
export const METASEARCH_KEY_PREFIX = 'smk_';
const KEY_PATTERN = /^smk_[A-Za-z0-9_-]{43}$/;
/** Characters of a key kept in clear so staff can recognise it. */
export const KEY_HINT_LENGTH = 12;

export const newMetasearchKey = (): string =>
  `${METASEARCH_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;

export const isMetasearchKey = (value: string): boolean => KEY_PATTERN.test(value);

export const keyHint = (key: string): string => key.slice(0, KEY_HINT_LENGTH);

export interface MetasearchLinkClaims {
  partnerId: string;
  request: FlightSearchRequest;
  /** `itineraryKey()` of the offer the partner showed: flights, departure instants, cabin, brand. */
  itinerary: string;
  /** The all-in total the partner showed, in the currency it asked for. */
  shown: Money;
}

export interface OpenedMetasearchLink extends MetasearchLinkClaims {
  issuedAt: Date;
  /** False once the link is older than METASEARCH_LINK_TTL_HOURS. */
  fresh: boolean;
}

const airport = z.string().regex(/^[A-Z]{3}$/);
const count = z.number().int().min(0).max(9);
// Short keys keep the deep link short; the envelope is authenticated, so nothing can be altered.
const sealedSchema = z.object({
  p: z.uuid(),
  s: z
    .array(z.tuple([airport, airport, z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]))
    .min(1)
    .max(5),
  a: z.tuple([count, count, count]),
  c: z.enum(CABIN_CLASSES),
  d: z.boolean(),
  k: z.string().min(1).max(1200),
  t: z.string().regex(/^\d{1,15}$/),
  m: z.string().regex(/^[A-Z]{3}$/),
  i: z.number().int().positive(),
});

/**
 * Metasearch deep links (ADR-081): AES-256-GCM envelopes of the partner, the search, the
 * itinerary and the price shown. They hold no personal data and cannot be altered or forged.
 */
@Injectable()
export class MetasearchLinks {
  constructor(
    private readonly encryption: FieldEncryption,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The website page a partner sends travellers to. */
  href(claims: MetasearchLinkClaims, now = Date.now()): string {
    return new URL(`/flights/go/${this.seal(claims, now)}`, this.config.WEB_APP_URL).toString();
  }

  seal(claims: MetasearchLinkClaims, now = Date.now()): string {
    const { request } = claims;
    const payload: z.infer<typeof sealedSchema> = {
      p: claims.partnerId,
      s: request.slices.map((slice) => [slice.origin, slice.destination, slice.departureDate]),
      a: [request.passengers.adults, request.passengers.children, request.passengers.infants],
      c: request.cabinClass,
      d: request.directOnly,
      k: claims.itinerary,
      t: claims.shown.minor.toString(),
      m: claims.shown.currency,
      i: now,
    };
    return this.encryption.encrypt(JSON.stringify(payload), metasearchLinkContext());
  }

  /** The claims of an authentic link, or null when it was altered, truncated or forged. */
  open(token: string, now = Date.now()): OpenedMetasearchLink | null {
    if (token.length > MAX_TOKEN_LENGTH) return null;
    let parsed: z.infer<typeof sealedSchema>;
    let shown: Money;
    try {
      const result = sealedSchema.safeParse(
        JSON.parse(this.encryption.decrypt(token, metasearchLinkContext())),
      );
      if (!result.success) return null;
      parsed = result.data;
      shown = money(BigInt(parsed.t), parsed.m);
    } catch {
      return null;
    }
    return {
      partnerId: parsed.p,
      request: {
        slices: parsed.s.map(([origin, destination, departureDate]) => ({
          origin,
          destination,
          departureDate,
        })),
        passengers: { adults: parsed.a[0], children: parsed.a[1], infants: parsed.a[2] },
        cabinClass: parsed.c,
        directOnly: parsed.d,
      },
      itinerary: parsed.k,
      shown,
      issuedAt: new Date(parsed.i),
      fresh: now - parsed.i < this.config.METASEARCH_LINK_TTL_HOURS * HOUR_MS,
    };
  }
}
