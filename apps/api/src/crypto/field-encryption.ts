import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

/**
 * Field-level encryption for secrets stored in the database (TOTP seeds now; passport numbers and
 * visa documents later). `context` is bound as additional authenticated data, so a ciphertext
 * copied to another row or column fails to decrypt.
 */
export abstract class FieldEncryption {
  abstract encrypt(plaintext: string, context: string): string;
  abstract decrypt(envelope: string, context: string): string;
}

const VERSION = 'v1';
const IV_BYTES = 12;

/**
 * AES-256-GCM with a key from FIELD_ENCRYPTION_KEY. Envelope: `v1.<iv>.<ciphertext>.<tag>`
 * (base64url). The cloud KMS envelope-encryption adapter (phase 12) writes `v2` envelopes and
 * keeps reading `v1`.
 */
@Injectable()
export class LocalKeyFieldEncryption extends FieldEncryption {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    if (config.FIELD_ENCRYPTION_KEY) {
      this.key = Buffer.from(config.FIELD_ENCRYPTION_KEY, 'base64');
    } else {
      new Logger(LocalKeyFieldEncryption.name).warn(
        'FIELD_ENCRYPTION_KEY is not set; using an ephemeral key (encrypted fields will not survive a restart)',
      );
      this.key = randomBytes(32);
    }
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      VERSION,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string, context: string): string {
    const [version, iv, ciphertext, tag] = envelope.split('.');
    if (version !== VERSION || !iv || ciphertext === undefined || !tag) {
      throw new Error('Unsupported field encryption envelope');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
