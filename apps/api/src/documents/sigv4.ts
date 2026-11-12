import { createHash, createHmac } from 'node:crypto';

/** SHA-256 of an empty body, which S3 expects as the payload hash of a GET or DELETE. */
export const EMPTY_PAYLOAD_HASH = createHash('sha256').update('').digest('hex');

export const sha256Hex = (data: Uint8Array | string): string =>
  createHash('sha256').update(data).digest('hex');

const hmac = (key: Uint8Array | string, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding as SigV4 wants it: unreserved characters kept, everything else %XX. */
const encode = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** A path encoded segment by segment, slashes kept. */
export const encodePath = (path: string): string => path.split('/').map(encode).join('/');

export interface SignInput {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  host: string;
  /** Already encoded, starting with a slash. */
  path: string;
  /** Header names in any case; `host`, `x-amz-date` and `x-amz-content-sha256` are added. */
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
}

/**
 * AWS Signature Version 4 for a request without a query string (ADR-057): the canonical request,
 * the string to sign and the derived signing key, as the S3 documentation defines them. Returns
 * the headers to send, `authorization` included.
 */
export function signRequest(input: SignInput): Record<string, string> {
  const service = input.service ?? 's3';
  const amzDate = input.date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
  }
  headers.host = input.host;
  headers['x-amz-date'] = amzDate;
  headers['x-amz-content-sha256'] = input.payloadHash;
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    input.method,
    input.path,
    '',
    ...names.map((name) => `${name}:${headers[name] ?? ''}`),
    '',
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
