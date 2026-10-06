import { HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import type { AuthContext } from '../auth/auth-context';
import { ProblemDetailsException } from '../common/problem-details';
import { requestContext, type RequestContext } from '../common/request-context';
import type { Prisma } from '../generated/prisma/client';

/** The staff member behind an admin change, for audit entries. */
export interface StaffActor {
  userId: string;
  context: RequestContext;
}

export const staffActor = (auth: AuthContext, request: Request): StaffActor => ({
  userId: auth.userId,
  context: requestContext(request),
});

export const conflict = (slug: string, title: string): ProblemDetailsException =>
  new ProblemDetailsException(HttpStatus.CONFLICT, slug, title);

/**
 * Checks a record merged from its stored values and a partial update with the rules for a new
 * one (or content whose schema depends on another field), answering like the contract's own
 * validation (400 `validation-failed`). `field` prefixes the reported paths.
 */
export function checkMerged<T>(schema: z.ZodType<T>, merged: unknown, field?: string): T {
  const result = schema.safeParse(merged);
  if (result.success) return result.data;
  throw new ProblemDetailsException(
    HttpStatus.BAD_REQUEST,
    'validation-failed',
    'Validation failed',
    'One or more fields are invalid.',
    {
      errors: result.error.issues.map((issue) => ({
        location: 'body',
        path: [...(field ? [field] : []), ...issue.path].join('.'),
        code: issue.code,
        message: issue.message,
      })),
    },
  );
}

type AuditValue = string | number | boolean | null | readonly string[];

/**
 * The fields a change touched with their old and new values (ADR-035), for audit metadata.
 * Long text listed in `namesOnly` is recorded as changed without its content. Never pass
 * personal data.
 */
export function fieldChanges(
  before: Readonly<Record<string, AuditValue>>,
  after: Readonly<Record<string, AuditValue>>,
  namesOnly: readonly string[] = [],
): Prisma.InputJsonObject {
  const changes: Record<string, Prisma.InputJsonObject> = {};
  for (const [key, value] of Object.entries(after)) {
    const previous = before[key] ?? null;
    if (JSON.stringify(previous) === JSON.stringify(value)) continue;
    changes[key] = namesOnly.includes(key) ? { changed: true } : { from: previous, to: value };
  }
  return changes;
}

export const hasChanges = (changes: Prisma.InputJsonObject): boolean =>
  Object.keys(changes).length > 0;

export const toMinor = (value: number | null): bigint | null =>
  value === null ? null : BigInt(value);
export const fromMinor = (value: bigint | null): number | null =>
  value === null ? null : Number(value);
export const toDate = (value: string | null): Date | null =>
  value === null ? null : new Date(value);
export const fromDate = (value: Date | null): string | null => value?.toISOString() ?? null;
