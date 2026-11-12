import { createApiClient, createApiHooks, type ApiClient, type Schemas } from '@suskii/api-client';

import { publicEnv } from './env';
import { label, t } from './i18n';
import { csrfToken, ensureFreshSession, expireSession, SESSION_EVENT } from './session';
import { isStepUpRequired, requestStepUp } from './step-up';

export type { Schemas };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Routes where a 401 means a mistyped code, not an ended session. */
const CODE_ROUTES = new Set(['/v1/me/mfa/step-up']);

/** Copies of writes in flight, kept so a write refused for step-up can be sent again. */
const replayable = new Map<string, Request>();

/**
 * The API from the console: typed routes and the API's session cookies. Every request first
 * refreshes an expiring session and every write carries the CSRF token; a write refused with
 * `step-up-required` asks for an authenticator code and is sent once more (ADR-037); a 401 for a
 * live session asks the staff gate to check the session again. Client components only.
 */
export const adminApi: ApiClient = createApiClient({
  baseUrl: publicEnv.apiBaseUrl,
  credentials: 'include',
});

adminApi.use({
  async onRequest({ request, schemaPath, id }) {
    // Sign-in and refresh routes manage the session themselves.
    if (!schemaPath.startsWith('/v1/auth/')) await ensureFreshSession();
    const csrf = csrfToken();
    if (!SAFE_METHODS.has(request.method)) {
      if (csrf) request.headers.set('X-CSRF-Token', csrf);
      replayable.set(id, request.clone());
    }
    return request;
  },
  async onResponse({ response, schemaPath, id }) {
    const original = replayable.get(id);
    replayable.delete(id);
    let result = response;
    if (original && (await isStepUpRequired(response)) && (await requestStepUp())) {
      // The prompt may have stayed open past the access cookie's lifetime.
      await ensureFreshSession();
      const retry = new Request(original);
      const csrf = csrfToken();
      if (csrf) retry.headers.set('X-CSRF-Token', csrf);
      result = await fetch(retry);
    }
    if (
      result.status === 401 &&
      !schemaPath.startsWith('/v1/auth/') &&
      !CODE_ROUTES.has(schemaPath)
    ) {
      expireSession();
      window.dispatchEvent(new Event(SESSION_EVENT));
    }
    return result;
  },
  onError({ id }) {
    replayable.delete(id);
  },
});

/** TanStack Query hooks: `$api.useQuery('get', '/v1/admin/promos', { params })`. */
export const $api = createApiHooks(adminApi);

export interface ProblemIssue {
  path: string;
  message: string;
}

export interface Problem {
  slug: string | null;
  status: number | null;
  issues: ProblemIssue[];
}

/** A failed call's problem body, wrapped so it can be thrown as an Error. */
export class ApiProblem extends Error {
  constructor(readonly body: unknown) {
    super('API request failed');
  }
}

/** The problem details of a failed call (openapi-fetch rejects with the response body). */
export function problemOf(error: unknown): Problem {
  const value = error instanceof ApiProblem ? error.body : error;
  if (typeof value !== 'object' || value === null) return { slug: null, status: null, issues: [] };
  const body = value as { type?: unknown; status?: unknown; errors?: unknown };
  const slug = typeof body.type === 'string' ? body.type.replace(/^urn:suskii:problem:/, '') : null;
  const issues = Array.isArray(body.errors)
    ? body.errors.flatMap((issue: unknown) => {
        if (typeof issue !== 'object' || issue === null) return [];
        const { path, message } = issue as { path?: unknown; message?: unknown };
        return typeof path === 'string' && typeof message === 'string' ? [{ path, message }] : [];
      })
    : [];
  return { slug, status: typeof body.status === 'number' ? body.status : null, issues };
}

/** A sentence for staff: the known problem, else a generic failure. */
export function problemMessage(error: unknown): string {
  const { slug } = problemOf(error);
  if (!slug) return t('problems.generic');
  const text = label('problems', slug);
  return text === slug ? t('problems.generic') : text;
}

/** Field errors by top-level path, for forms ("value" -> "percent_too_large"). */
export function fieldErrors(error: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of problemOf(error).issues) {
    const field = issue.path.split('.')[0] ?? issue.path;
    result[field] ??= issue.message;
  }
  return result;
}

/** A fresh key per logical write (refund requests); retries of the same write reuse it. */
export const idempotencyKey = (): string => crypto.randomUUID();
