import type { Request } from 'express';

import { documentTooLarge, documentType } from './visa-documents.service';
import { VISA_DOCUMENT_URL_TYPES } from './visa.schemas';

interface UploadRules {
  /** The declared types accepted; what the bytes are is checked by the caller. */
  types: readonly string[];
  tooLarge: (maxBytes: number) => Error;
  wrongType: () => Error;
}

const DOCUMENT_RULES: UploadRules = {
  types: VISA_DOCUMENT_URL_TYPES,
  tooLarge: documentTooLarge,
  wrongType: documentType,
};

/**
 * The upload's bytes, read here with a hard size limit: no body parser buffers them for us (JSON
 * is the only parsed type), so an oversized upload is refused before it is read in full.
 */
export async function readUpload(
  request: Request,
  maxBytes: number,
  rules: UploadRules = DOCUMENT_RULES,
): Promise<Buffer> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw rules.tooLarge(maxBytes);
  const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!rules.types.includes(type)) throw rules.wrongType();
  if (Buffer.isBuffer(request.body)) {
    if (request.body.byteLength > maxBytes) throw rules.tooLarge(maxBytes);
    return request.body;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > maxBytes) throw rules.tooLarge(maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
