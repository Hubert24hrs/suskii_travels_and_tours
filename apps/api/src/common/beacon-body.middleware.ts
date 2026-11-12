import { HttpStatus, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { ProblemDetailsException } from './problem-details';

/**
 * Routes whose contract sets `beacon: true`. Only these read a `text/plain` body as JSON: on any
 * other route such a body stays unparsed, so a cross-site form (which can send text/plain without
 * a preflight) cannot deliver JSON to it.
 */
export const BEACON_PATHS: ReadonlySet<string> = new Set(['/v1/telemetry/web-vitals']);

/** Beacons carry a few hundred bytes; anything near this is not one. */
export const MAX_BEACON_BYTES = 8 * 1024;

const tooLarge = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.PAYLOAD_TOO_LARGE,
    'payload-too-large',
    'Payload too large',
  );

const malformed = (): ProblemDetailsException =>
  new ProblemDetailsException(HttpStatus.BAD_REQUEST, 'malformed-body', 'The body is not JSON');

/**
 * `navigator.sendBeacon(url, string)` posts `text/plain;charset=UTF-8`. On beacon routes the text
 * is read with a size limit and parsed as the JSON body, which the route's contract then
 * validates like any other.
 */
@Injectable()
export class BeaconBodyMiddleware implements NestMiddleware {
  async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    const path = request.originalUrl.split('?')[0] ?? '';
    if (request.method !== 'POST' || type !== 'text/plain' || !BEACON_PATHS.has(path)) {
      next();
      return;
    }
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BEACON_BYTES) throw tooLarge();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request as AsyncIterable<Buffer>) {
      size += chunk.byteLength;
      if (size > MAX_BEACON_BYTES) throw tooLarge();
      chunks.push(chunk);
    }
    try {
      request.body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw malformed();
    }
    next();
  }
}
