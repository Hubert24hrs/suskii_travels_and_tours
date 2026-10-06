import { SetMetadata } from '@nestjs/common';
import { z } from 'zod';

import type { AuditAction } from '../audit/audit.service';

/**
 * The single description of an endpoint: validates input, filters output (so internal fields such
 * as password hashes can never leak) and generates the OpenAPI 3.1 document and typed client.
 */
export interface RouteContract {
  /** Stable, unique operation id; becomes the client method name. */
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
  /** Response schema per status code; `null` means no body (e.g. 204). */
  responses: Partial<Record<number, z.ZodType | null>>;
  /** Documented problem+json statuses (400 and 500 are implied). */
  errors?: number[];
  /** Requires an Idempotency-Key header; retries replay the first response (IdempotencyInterceptor). */
  idempotent?: boolean;
  /** Extra request headers to document (validation stays with the handler). */
  headers?: { name: string; required: boolean; description: string }[];
  /**
   * A raw binary request body (file upload) instead of JSON: documented with these media types;
   * the handler reads and checks the bytes itself (size, type sniffing).
   */
  upload?: { contentTypes: readonly string[]; description: string };
  /**
   * Admin mutations: the audit actions the route may record (one of them per successful call).
   * Published as `x-audit`; the audit coverage e2e test checks it (ADR-034).
   */
  audit?: readonly AuditAction[];
}

export const CONTRACT = 'suskii:contract';

export const Contract = (contract: RouteContract): MethodDecorator =>
  SetMetadata(CONTRACT, contract);

/**
 * Registry of named schemas; each becomes `#/components/schemas/<name>` in the OpenAPI
 * document and a named type in the generated client.
 */
export const schemaRegistry = z.registry<{ id: string }>();

export function named<T extends z.ZodType>(id: string, schema: T): T {
  schemaRegistry.add(schema, { id });
  return schema;
}

/** Media type of each binary response schema created by `fileResponse()`. */
export const fileResponses = new WeakMap<z.ZodType, string>();

/**
 * A binary response (e.g. a PDF): the handler returns a `StreamableFile`, which passes through the
 * contract untouched and is documented as `format: binary` with the given media type.
 */
export function fileResponse(contentType: string): z.ZodType {
  const schema = z.custom<unknown>(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { getStream?: unknown }).getStream === 'function',
  );
  fileResponses.set(schema, contentType);
  return schema;
}
