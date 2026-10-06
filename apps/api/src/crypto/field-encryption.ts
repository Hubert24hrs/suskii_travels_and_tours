import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

/**
 * Field-level encryption for secrets stored in the database (TOTP seeds, passport numbers, visa
 * document keys, booking contacts; the full list is `ENCRYPTED_FIELDS`). `context` is bound as
 * additional authenticated data, so a ciphertext copied to another row or column fails to
 * decrypt.
 */
export abstract class FieldEncryption {
  abstract encrypt(plaintext: string, context: string): string;
  abstract decrypt(envelope: string, context: string): string;
  /** False when the envelope was written under an older key (or format) and should be rewritten. */
  abstract isCurrent(envelope: string): boolean;
}

const IV_BYTES = 12;
/** Fixed GCM tag length: without it Node accepts truncated tags, which weakens authenticity. */
const GCM = { authTagLength: 16 } as const;
const KEY_ID = /^[a-z0-9]{1,16}$/;

function open(key: Buffer, iv: string, ciphertext: string, tag: string, context: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), GCM);
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * AES-256-GCM with a key ring (ADR-038). New envelopes are `v2.<keyId>.<iv>.<ciphertext>.<tag>`
 * (base64url) under FIELD_ENCRYPTION_KEY / FIELD_ENCRYPTION_KEY_ID; envelopes under a key listed
 * in FIELD_ENCRYPTION_PREVIOUS_KEYS still decrypt until `keys:reencrypt` rewrites them. Phase 2
 * envelopes (`v1.<iv>.<ciphertext>.<tag>`, no key id) are tried against every key in the ring;
 * the GCM tag tells which one is right. The cloud KMS adapter (phase 12) keeps this format with
 * wrapped data keys.
 */
@Injectable()
export class LocalKeyFieldEncryption extends FieldEncryption {
  private readonly currentId: string;
  private readonly keys = new Map<string, Buffer>();

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.currentId = config.FIELD_ENCRYPTION_KEY_ID;
    if (config.FIELD_ENCRYPTION_KEY) {
      this.keys.set(this.currentId, Buffer.from(config.FIELD_ENCRYPTION_KEY, 'base64'));
    } else {
      new Logger(LocalKeyFieldEncryption.name).warn(
        'FIELD_ENCRYPTION_KEY is not set; using an ephemeral key (encrypted fields will not survive a restart)',
      );
      this.keys.set(this.currentId, randomBytes(32));
    }
    for (const entry of config.FIELD_ENCRYPTION_PREVIOUS_KEYS) {
      const separator = entry.indexOf(':');
      this.keys.set(entry.slice(0, separator), Buffer.from(entry.slice(separator + 1), 'base64'));
    }
  }

  encrypt(plaintext: string, context: string): string {
    const key = this.keys.get(this.currentId);
    if (!key) throw new Error('The current field encryption key is missing');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv, GCM);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      'v2',
      this.currentId,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string, context: string): string {
    const parts = envelope.split('.');
    if (parts[0] === 'v2' && parts.length === 5) {
      const [, keyId = '', iv = '', ciphertext = '', tag = ''] = parts;
      const key = KEY_ID.test(keyId) ? this.keys.get(keyId) : undefined;
      // Never name the key id in the error: it ends up in logs.
      if (!key || !iv || !tag) throw new Error('No key for this field encryption envelope');
      return open(key, iv, ciphertext, tag, context);
    }
    if (parts[0] === 'v1' && parts.length === 4) {
      const [, iv = '', ciphertext = '', tag = ''] = parts;
      if (!iv || !tag) throw new Error('Unsupported field encryption envelope');
      for (const key of this.keys.values()) {
        try {
          return open(key, iv, ciphertext, tag, context);
        } catch {
          // Wrong key (or tampered data): try the next one.
        }
      }
      throw new Error('No key for this field encryption envelope');
    }
    throw new Error('Unsupported field encryption envelope');
  }

  isCurrent(envelope: string): boolean {
    return envelope.startsWith(`v2.${this.currentId}.`);
  }
}
