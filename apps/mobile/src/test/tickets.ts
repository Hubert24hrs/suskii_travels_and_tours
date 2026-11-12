import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

/**
 * Signs bus ticket QR payloads like the API's `TicketSigner` (ADR-050), so offline scanning is
 * tested against real Ed25519 signatures and the published SPKI key format.
 */
export function ticketSigner(): {
  kid: string;
  spki: string;
  ticket: (claims: Record<string, unknown>, key?: KeyObject) => string;
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const kid = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16);
  const spki = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' }).toString()).toString(
    'base64',
  );
  const ticket = (claims: Record<string, unknown>, key: KeyObject = privateKey): string => {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signed = `SUSKII-T1.${kid}.${body}`;
    return `${signed}.${sign(null, Buffer.from(signed), key).toString('base64url')}`;
  };
  return { kid, spki, ticket };
}
