import { hasPermissions, STAFF_ROLES, type Role } from '@suskii/shared';

import { buildOpenApiDocument } from '../src/openapi/openapi';

import {
  adminOperations,
  bearer,
  committedOpenApi,
  staffCookieSession,
  staffSession,
  staffWithoutMfa,
  viaCookie,
  type AdminOperation,
  type CookieSession,
} from './helpers/admin';
import { signUp, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * ADR-034: every /v1/admin operation in the OpenAPI document, called by each kind of caller.
 * Only staff holding all the route's permissions, signed in with MFA, from the admin console
 * origin (cookie sessions) or with a bearer token, get past authentication and authorisation.
 * Sample parameters name nothing, so permitted calls answer 400 or 404 and change nothing.
 * Step-up operations (ADR-037) also refuse a session whose last authenticator check is too old.
 */
const OPERATIONS = adminOperations(committedOpenApi());
const LIMITED_ROLES = STAFF_ROLES.filter((role) => role !== 'super_admin');

function roleLacking(operation: AdminOperation): Role {
  const role = LIMITED_ROLES.find(
    (candidate) => !hasPermissions([candidate], operation.permissions),
  );
  if (!role) throw new Error(`every staff role may call ${operation.operationId}`);
  return role;
}

describe('admin route permission matrix (e2e)', () => {
  let ctx: TestContext;
  let customer: TokenSession;
  let withoutMfa: TokenSession;
  let admin: TokenSession;
  let staleAdmin: TokenSession;
  let adminConsole: CookieSession;
  const limited = new Map<Role, TokenSession>();

  beforeAll(async () => {
    // Several hundred requests from one address: the limiter is tested elsewhere.
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
    await resetState(ctx);
    customer = await signUp(ctx, 'matrix-customer@example.com');
    withoutMfa = await staffWithoutMfa(ctx, 'matrix-no-mfa@example.com', ['super_admin']);
    admin = await staffSession(ctx, 'matrix-admin@example.com', ['super_admin']);
    adminConsole = await staffCookieSession(ctx, 'matrix-console@example.com', ['super_admin']);
    staleAdmin = await staffSession(ctx, 'matrix-stale@example.com', ['super_admin']);
    await ctx.prisma.session.update({
      where: { id: staleAdmin.sessionId },
      data: { mfaVerifiedAt: new Date(Date.now() - 60 * 60_000) },
    });
    for (const role of LIMITED_ROLES) {
      limited.set(role, await staffSession(ctx, `matrix-${role}@example.com`, [role]));
    }
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('covers every admin operation the running app serves', () => {
    const live = adminOperations(buildOpenApiDocument(ctx.app));
    expect(OPERATIONS.map((operation) => operation.operationId).sort()).toEqual(
      live.map((operation) => operation.operationId).sort(),
    );
    expect(OPERATIONS.length).toBeGreaterThanOrEqual(70);
    const ids = (list: AdminOperation[]) => list.map((operation) => operation.operationId);
    expect({
      withoutPermissions: ids(OPERATIONS.filter((operation) => operation.permissions.length === 0)),
      mutationsWithoutAudit: ids(
        OPERATIONS.filter(
          (operation) => operation.method !== 'get' && operation.audit.length === 0,
        ),
      ),
    }).toEqual({ withoutPermissions: [], mutationsWithoutAudit: [] });
  });

  it.each(OPERATIONS)('$operationId: $method $path', async (operation) => {
    const call = async (headers: Record<string, string>) => {
      const request = ctx.http()[operation.method](operation.samplePath).set(headers);
      const response = operation.method === 'get' ? await request : await request.send({});
      return { status: response.status, type: (response.body as { type?: string }).type };
    };
    const role = roleLacking(operation);
    const results = {
      anonymous: await call({}),
      customer: await call(bearer(customer.accessToken)),
      [`${role} (lacks ${operation.permissions.join(', ')})`]: await call(
        bearer(limited.get(role)?.accessToken ?? ''),
      ),
      staffWithoutMfa: await call(bearer(withoutMfa.accessToken)),
      foreignOrigin: await call(viaCookie(adminConsole, 'https://attacker.example')),
      cookieWithoutOrigin: await call({
        Cookie: adminConsole.cookie,
        'X-CSRF-Token': adminConsole.csrfToken,
      }),
    };
    expect(results).toEqual({
      anonymous: { status: 401, type: 'urn:suskii:problem:authentication-required' },
      customer: { status: 403, type: 'urn:suskii:problem:forbidden' },
      [`${role} (lacks ${operation.permissions.join(', ')})`]: {
        status: 403,
        type: 'urn:suskii:problem:forbidden',
      },
      staffWithoutMfa: { status: 403, type: 'urn:suskii:problem:mfa-required' },
      foreignOrigin: { status: 403, type: 'urn:suskii:problem:forbidden' },
      cookieWithoutOrigin: { status: 403, type: 'urn:suskii:problem:forbidden' },
    });

    const stale = await call(bearer(staleAdmin.accessToken));
    if (operation.stepUp) {
      expect(stale).toEqual({ status: 403, type: 'urn:suskii:problem:step-up-required' });
    }
    for (const allowed of [
      await call(bearer(admin.accessToken)),
      await call(viaCookie(adminConsole)),
      ...(operation.stepUp ? [] : [stale]),
    ]) {
      expect([401, 403]).not.toContain(allowed.status);
      expect(allowed.status).toBeLessThan(500);
      // Sample parameters and empty bodies never reach a record: mutations change nothing.
      if (operation.method !== 'get') expect(allowed.status).toBeGreaterThanOrEqual(400);
    }
  });
});
