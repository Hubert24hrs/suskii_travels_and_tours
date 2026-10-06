import {
  HttpStatus,
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { catchError, concatMap, from, of, switchMap, throwError, type Observable } from 'rxjs';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { ProblemDetailsException } from '../common/problem-details';
import { requestContext } from '../common/request-context';
import { CONTRACT, type RouteContract } from '../contract/contract';
import { resolveResponseStatus } from '../contract/contract.interceptor';
import { FieldEncryption } from '../crypto/field-encryption';
import { HmacService } from '../crypto/hmac.service';
import { sha256 } from '../crypto/random';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { idempotencySealContext as sealContext } from '../crypto/encryption-contexts';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const RETENTION_MS = 24 * 60 * 60 * 1000;

/** Stable JSON: object keys sorted, so `{a,b}` and `{b,a}` hash the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const problem = (status: HttpStatus, slug: string, title: string, detail: string, headers = {}) =>
  new ProblemDetailsException(status, slug, title, detail, {}, headers);

/**
 * `Idempotency-Key` for routes whose contract sets `idempotent: true` (bookings, payments,
 * refunds). Keys are scoped to the caller and kept 24 hours in Postgres:
 * - first request: claimed atomically (unique constraint), executed, response stored;
 * - retry with the same payload: the stored response is replayed (`Idempotent-Replayed: true`);
 * - retry while the first is still running: 409, retry shortly;
 * - same key with a different payload: 422.
 * Failed requests release the key so the client can retry. Stored responses are encrypted (bound
 * to the key's row), because they can carry secrets such as a guest booking's access token.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly hmac: HmacService,
    private readonly encryption: FieldEncryption,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = context.getHandler();
    const contract = this.reflector.get<RouteContract | undefined>(CONTRACT, handler);
    if (!contract?.idempotent || context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const header = request.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    if (!key || !KEY_PATTERN.test(key)) {
      throw problem(
        HttpStatus.BAD_REQUEST,
        'idempotency-key-required',
        'Idempotency-Key header required',
        'Send a unique Idempotency-Key (8-128 characters: letters, digits, - or _) per operation.',
      );
    }
    const scope = request.auth
      ? `user:${request.auth.userId}`
      : `anon:${this.hmac.digest('ip', requestContext(request).ip)}`;
    const requestHash = sha256(
      `${request.method} ${contract.operationId} ${canonicalJson(request.body ?? {})}`,
    );

    return from(this.claim(scope, key, requestHash)).pipe(
      switchMap((claim) => {
        if (claim.replay) {
          response.status(claim.replay.status);
          response.setHeader('Idempotent-Replayed', 'true');
          return of(claim.replay.body);
        }
        return next.handle().pipe(
          concatMap(async (data: unknown) => {
            await this.complete(
              claim.id,
              resolveResponseStatus(this.reflector, handler, response),
              data,
            );
            return data;
          }),
          // Release only the key this request claimed, so a corrected retry can run.
          catchError((error: unknown) =>
            from(this.release(claim.id)).pipe(switchMap(() => throwError(() => error))),
          ),
        );
      }),
    );
  }

  private async claim(
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<
    | { id: string; replay?: undefined }
    | { id?: undefined; replay: { status: number; body: unknown } }
  > {
    const now = new Date();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const row = await this.prisma.idempotencyKey.create({
          data: { scope, key, requestHash, expiresAt: new Date(now.getTime() + RETENTION_MS) },
          select: { id: true },
        });
        return { id: row.id };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
          throw error;
      }
      const existing = await this.prisma.idempotencyKey.findUnique({
        where: { scope_key: { scope, key } },
      });
      if (!existing) continue;
      if (existing.expiresAt <= now) {
        await this.prisma.idempotencyKey.deleteMany({
          where: { id: existing.id, expiresAt: { lte: now } },
        });
        continue;
      }
      if (existing.requestHash !== requestHash) {
        throw problem(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'idempotency-key-reused',
          'Idempotency-Key reused with a different request',
          'Use a new key for a different operation.',
        );
      }
      if (existing.status === 'in_progress' || existing.responseStatus === null) {
        throw problem(
          HttpStatus.CONFLICT,
          'idempotency-request-in-progress',
          'Request already in progress',
          'The original request with this key is still running. Retry shortly.',
          { 'Retry-After': '1' },
        );
      }
      const stored = existing.responseBody as { sealed?: string; body?: unknown } | null;
      const body =
        typeof stored?.sealed === 'string'
          ? (JSON.parse(
              this.encryption.decrypt(stored.sealed, sealContext(existing.id)),
            ) as unknown)
          : stored?.body;
      return { replay: { status: existing.responseStatus, body } };
    }
    throw problem(
      HttpStatus.CONFLICT,
      'idempotency-request-in-progress',
      'Request already in progress',
      'Retry shortly.',
      {
        'Retry-After': '1',
      },
    );
  }

  private async complete(id: string, status: number, body: unknown): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { id },
      data: {
        status: 'completed',
        responseStatus: status,
        responseBody: {
          sealed: this.encryption.encrypt(JSON.stringify(body ?? null), sealContext(id)),
        },
      },
    });
  }

  private async release(id: string): Promise<void> {
    try {
      await this.prisma.idempotencyKey.deleteMany({ where: { id, status: 'in_progress' } });
    } catch (error) {
      this.logger.error({ err: error }, 'failed to release idempotency key');
    }
  }
}
