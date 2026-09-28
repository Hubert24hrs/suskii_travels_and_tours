import { SetMetadata } from '@nestjs/common';
import { z } from 'zod';

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
