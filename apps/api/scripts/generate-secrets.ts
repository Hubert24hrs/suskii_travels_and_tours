/**
 * Prints fresh values for the API's secrets, ready to paste into a local `.env` or a cloud secret
 * manager. Nothing is written to disk.
 *
 *   pnpm --filter @suskii/api keys:generate
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const base64Pem = (pem: string): string => Buffer.from(pem).toString('base64');

const lines = [
  '# Ed25519 access-token signing keys (base64 of the PEM).',
  `JWT_PRIVATE_KEY=${base64Pem(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())}`,
  `JWT_PUBLIC_KEY=${base64Pem(publicKey.export({ type: 'spki', format: 'pem' }).toString())}`,
  '# AES-256-GCM key for field-level encryption (32 bytes, base64).',
  `FIELD_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
  '# Master secret for HMAC subkeys (IP hashing, CSRF, OTP and recovery-code hashes).',
  `HMAC_SECRET=${randomBytes(48).toString('base64url')}`,
];
process.stdout.write(`${lines.join('\n')}\n`);
