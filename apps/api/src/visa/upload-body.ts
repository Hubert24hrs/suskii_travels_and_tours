import type { Request } from 'express';

import { documentTooLarge, documentType } from './visa-documents.service';
import { VISA_DOCUMENT_URL_TYPES } from './visa.schemas';

/**
 * The upload's bytes, read here with a hard size limit: no body parser buffers them for us (JSON
 * is the only parsed type), so an oversized upload is refused before it is read in full.
 */
export async function readUpload(request: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw documentTooLarge(maxBytes);
  const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!(VISA_DOCUMENT_URL_TYPES as readonly string[]).includes(type)) throw documentType();
  if (Buffer.isBuffer(request.body)) {
    if (request.body.byteLength > maxBytes) throw documentTooLarge(maxBytes);
    return request.body;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > maxBytes) throw documentTooLarge(maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
