import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { TICKET_QR_PREFIX, type TicketClaims } from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';

const decodePem = (value: string): string => Buffer.from(value, 'base64').toString('utf8');

/** A key id: the first 16 hex characters of the SHA-256 of the raw public key (SPKI DER). */
const keyId = (key: KeyObject): string =>
  createHash('sha256')
    .update(key.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16);

export type TicketVerdict =
  | { valid: true; claims: TicketClaims }
  | {
      valid: false;
      reason: 'malformed' | 'bad_signature' | 'unknown_key' | 'not_yet_valid' | 'expired';
    };

export interface TicketPublicKey {
  kid: string;
  /** Base64 of the SPKI PEM, for offline scanners (ADR-050). */
  spki: string;
}

/**
 * Signs and verifies bus ticket QR payloads (ADR-050):
 * `SUSKII-T1.<kid>.<base64url claims>.<base64url Ed25519 signature>`. The claims hold ids and the
 * boarding window, never personal data, so a scanner can check a ticket offline with the public
 * key and the server can check it online. Previous public keys keep old tickets valid after a
 * rotation.
 */
@Injectable()
export class TicketSigner implements OnModuleInit {
  private readonly logger = new Logger(TicketSigner.name);
  private privateKey!: KeyObject;
  private kid!: string;
  private readonly publicKeys = new Map<string, KeyObject>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onModuleInit(): void {
    if (this.config.CARS_TICKET_SIGNING_KEY) {
      this.privateKey = createPrivateKey(decodePem(this.config.CARS_TICKET_SIGNING_KEY));
    } else {
      // Production requires a configured key when buses are on (env schema).
      this.logger.warn('CARS_TICKET_SIGNING_KEY is not set; tickets use a per-process key');
      this.privateKey = generateKeyPairSync('ed25519').privateKey;
    }
    if (this.privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('CARS_TICKET_SIGNING_KEY must be an Ed25519 private key');
    }
    const current = createPublicKey(this.privateKey);
    this.kid = keyId(current);
    this.publicKeys.set(this.kid, current);
    for (const pem of this.config.CARS_TICKET_PREVIOUS_PUBLIC_KEYS?.split('|').filter(Boolean) ??
      []) {
      const key = createPublicKey(decodePem(pem));
      this.publicKeys.set(keyId(key), key);
    }
  }

  sign(claims: TicketClaims): string {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signed = `${TICKET_QR_PREFIX}.${this.kid}.${body}`;
    const signature = sign(null, Buffer.from(signed), this.privateKey).toString('base64url');
    return `${signed}.${signature}`;
  }

  verify(payload: string, now: Date = new Date()): TicketVerdict {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== TICKET_QR_PREFIX)
      return { valid: false, reason: 'malformed' };
    const [prefix, kid = '', body = '', signature = ''] = parts;
    const key = this.publicKeys.get(kid);
    if (!key) return { valid: false, reason: 'unknown_key' };
    let ok = false;
    try {
      ok = verify(
        null,
        Buffer.from(`${prefix}.${kid}.${body}`),
        key,
        Buffer.from(signature, 'base64url'),
      );
    } catch {
      return { valid: false, reason: 'malformed' };
    }
    if (!ok) return { valid: false, reason: 'bad_signature' };
    const claims = parseClaims(body);
    if (!claims) return { valid: false, reason: 'malformed' };
    const seconds = Math.floor(now.getTime() / 1000);
    if (seconds < claims.nbf) return { valid: false, reason: 'not_yet_valid' };
    if (seconds > claims.exp) return { valid: false, reason: 'expired' };
    return { valid: true, claims };
  }

  /** Every key a valid ticket may be signed with, newest first. */
  keys(): TicketPublicKey[] {
    return [...this.publicKeys.entries()].map(([kid, key]) => ({
      kid,
      spki: Buffer.from(key.export({ type: 'spki', format: 'pem' }).toString()).toString('base64'),
    }));
  }
}

function parseClaims(body: string): TicketClaims | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null) return null;
    const { tid, trp, st, nbf, exp } = value as Record<string, unknown>;
    if (
      typeof tid !== 'string' ||
      typeof trp !== 'string' ||
      typeof st !== 'string' ||
      typeof nbf !== 'number' ||
      typeof exp !== 'number'
    ) {
      return null;
    }
    return { tid, trp, st, nbf, exp };
  } catch {
    return null;
  }
}
