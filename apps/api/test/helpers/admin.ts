import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Permission, Role } from '@suskii/shared';

import {
  bearer,
  cookieHeader,
  enrolTotp,
  grantRoles,
  parseSetCookies,
  PASSWORD,
  signUp,
  totp,
  type TokenSession,
} from './flows';
import type { TestContext } from './test-app';

/** The admin console origin the test app accepts (the ADMIN_ORIGINS default). */
export const ADMIN_ORIGIN = 'http://localhost:3001';
export const MISSING_ID = '0192f0e0-0000-7000-8000-000000000000';

const AT = '__Secure-suskii_at';
const CSRF = '__Secure-suskii_csrf';

export interface CookieSession {
  userId: string;
  cookie: string;
  csrfToken: string;
}

/** Headers for a cookie-authenticated request from `origin` (the console by default). */
export const viaCookie = (
  session: CookieSession,
  origin = ADMIN_ORIGIN,
): Record<string, string> => ({
  Cookie: session.cookie,
  'X-CSRF-Token': session.csrfToken,
  Origin: origin,
});

async function staffSignIn(
  ctx: TestContext,
  email: string,
  roles: Role[],
  transport: 'token' | 'cookie',
): Promise<{
  userId: string;
  secret: string;
  body: Record<string, unknown>;
  setCookie: string[];
}> {
  const initial = await signUp(ctx, email);
  await grantRoles(ctx, initial.userId, roles);
  const { secret } = await enrolTotp(ctx, initial.accessToken);
  const pending = await ctx
    .http()
    .post('/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const verified = await ctx
    .http()
    .post('/v1/auth/mfa/verify')
    .send({ mfaToken: pending.body.mfaToken, code: totp(secret, 1), transport })
    .expect(200);
  const header = verified.headers['set-cookie'] as string[] | string | undefined;
  return {
    userId: initial.userId,
    secret,
    body: verified.body as Record<string, unknown>,
    setCookie: header === undefined ? [] : Array.isArray(header) ? header : [header],
  };
}

/** A staff member who completed MFA at sign-in, with bearer tokens and the TOTP secret. */
export async function staffSession(
  ctx: TestContext,
  email: string,
  roles: Role[],
): Promise<TokenSession & { secret: string }> {
  const { userId, secret, body } = await staffSignIn(ctx, email, roles, 'token');
  return {
    userId,
    secret,
    sessionId: body.sessionId as string,
    accessToken: body.accessToken as string,
    refreshToken: body.refreshToken as string,
  };
}

/** A staff member who completed MFA at sign-in, with session cookies (the admin console). */
export async function staffCookieSession(
  ctx: TestContext,
  email: string,
  roles: Role[],
): Promise<CookieSession> {
  const { userId, body, setCookie } = await staffSignIn(ctx, email, roles, 'cookie');
  const cookies = parseSetCookies(setCookie);
  return { userId, cookie: cookieHeader(cookies, [AT, CSRF]), csrfToken: body.csrfToken as string };
}

/** Staff with roles but without MFA: their session can enrol, not use admin routes. */
export async function staffWithoutMfa(
  ctx: TestContext,
  email: string,
  roles: Role[],
): Promise<TokenSession> {
  const initial = await signUp(ctx, email);
  await grantRoles(ctx, initial.userId, roles);
  const refreshed = await ctx
    .http()
    .post('/v1/auth/refresh')
    .send({ refreshToken: initial.refreshToken })
    .expect(200);
  return {
    ...initial,
    accessToken: refreshed.body.accessToken as string,
    refreshToken: refreshed.body.refreshToken as string,
  };
}

export { bearer };

// ---------------------------------------------------------------------------
// The admin surface, as the OpenAPI document declares it (ADR-034)
// ---------------------------------------------------------------------------

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface AdminOperation {
  method: HttpMethod;
  path: string;
  operationId: string;
  permissions: Permission[];
  audit: string[];
  /** Needs an authenticator check within STEP_UP_WINDOW_MINUTES (`x-step-up`, ADR-037). */
  stepUp: boolean;
  /** A request path with sample parameters that name nothing (404) or stay invalid (400). */
  samplePath: string;
}

interface ParameterObject {
  name: string;
  in: string;
  schema?: { format?: string; enum?: string[]; pattern?: string };
}
interface OperationObject {
  operationId?: string;
  parameters?: (ParameterObject | { $ref: string })[];
  'x-admin-permissions'?: Permission[];
  'x-audit'?: string[];
  'x-step-up'?: boolean;
}
export interface OpenApiDocument {
  paths: Record<string, Partial<Record<HttpMethod, OperationObject>>>;
  components: { parameters?: Record<string, ParameterObject>; [section: string]: unknown };
}

/** Values that can never match a stored record, so a permitted call changes nothing. */
function sampleValue(parameter: ParameterObject): string {
  if (parameter.schema?.format === 'uuid') return MISSING_ID;
  if (parameter.schema?.enum?.[0]) return parameter.schema.enum[0];
  if (parameter.name === 'key' && parameter.schema?.pattern) return 'e2e_missing';
  if (parameter.name === 'key') return 'page.e2e-matrix';
  throw new Error(`no sample value for path parameter ${parameter.name}`);
}

export function adminOperations(doc: OpenApiDocument): AdminOperation[] {
  const operations: AdminOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    if (!path.startsWith('/v1/admin/')) continue;
    for (const [method, operation] of Object.entries(item) as [HttpMethod, OperationObject][]) {
      if (!operation.operationId) continue;
      const parameters = (operation.parameters ?? []).map((parameter) =>
        '$ref' in parameter
          ? doc.components.parameters?.[parameter.$ref.split('/').at(-1) ?? '']
          : parameter,
      );
      let samplePath = path;
      for (const parameter of parameters) {
        if (parameter?.in === 'path') {
          samplePath = samplePath.replace(`{${parameter.name}}`, sampleValue(parameter));
        }
      }
      operations.push({
        method,
        path,
        operationId: operation.operationId,
        permissions: operation['x-admin-permissions'] ?? [],
        audit: operation['x-audit'] ?? [],
        stepUp: operation['x-step-up'] === true,
        samplePath,
      });
    }
  }
  return operations;
}

/** The committed document; platform.e2e-spec checks it matches the running app. */
export function committedOpenApi(): OpenApiDocument {
  return JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'openapi.json'), 'utf8'),
  ) as OpenApiDocument;
}

// ---------------------------------------------------------------------------
// Content the admin suites create (seeded content stays as it was: the home suite relies on it)
// ---------------------------------------------------------------------------

export const E2E_PREFIX = 'e2e';

export async function cleanAdminContent(ctx: TestContext): Promise<void> {
  await ctx.prisma.dealRoute.deleteMany({ where: { slug: { startsWith: `${E2E_PREFIX}-` } } });
  await ctx.prisma.destinationContent.deleteMany({
    where: { slug: { startsWith: `${E2E_PREFIX}-` } },
  });
  await ctx.prisma.cmsBlock.deleteMany({ where: { key: { startsWith: `page.${E2E_PREFIX}-` } } });
  await ctx.prisma.faq.deleteMany({ where: { question: { startsWith: 'E2E' } } });
  await ctx.prisma.trustSignal.deleteMany({ where: { key: { startsWith: `${E2E_PREFIX}_` } } });
}
