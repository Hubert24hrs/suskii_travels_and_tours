import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { hasPermissions, isStaff, type Permission } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { requestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';

import type { AuthenticatedRequest } from './auth-context';
import { IS_ADMIN_ROUTE, REQUIRED_PERMISSIONS, STEP_UP } from './decorators';
import { authenticationRequired, forbidden, mfaRequired, stepUpRequired } from './errors';
import { SessionService } from './session.service';

/**
 * RBAC: routes declare permissions with `@RequirePermissions()` / `@AdminRoute()`; roles map to
 * permissions through the code catalog in @suskii/shared. Admin routes additionally require a staff
 * role, an MFA-verified session, an allowlisted IP (when ADMIN_IP_ALLOWLIST is set) and, for
 * cookie sessions, the admin console's origin. `@StepUp()` routes also need an authenticator check
 * within STEP_UP_WINDOW_MINUTES (ADR-037).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const required = [
      ...new Set(
        targets.flatMap(
          (target) =>
            this.reflector.get<Permission[] | undefined>(REQUIRED_PERMISSIONS, target) ?? [],
        ),
      ),
    ];
    const adminRoute =
      this.reflector.getAllAndOverride<boolean | undefined>(IS_ADMIN_ROUTE, targets) === true;
    if (required.length === 0 && !adminRoute) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;
    if (!auth) throw authenticationRequired();

    let reason: string | null = null;
    if (adminRoute && !isStaff(auth.roles)) reason = 'not_staff';
    else if (adminRoute && !this.ipAllowed(requestContext(request).ip))
      reason = 'ip_not_allowlisted';
    else if (adminRoute && auth.via === 'cookie' && !this.originAllowed(request.headers.origin))
      reason = 'origin_not_allowed';
    else if (!hasPermissions(auth.roles, required)) reason = 'missing_permission';

    if (reason) {
      if (adminRoute) {
        await this.audit.record({
          action: 'rbac.access_denied',
          actorUserId: auth.userId,
          context: requestContext(request),
          metadata: {
            reason,
            route: request.route ? String((request.route as { path: unknown }).path) : request.path,
            required,
          },
        });
      }
      throw forbidden();
    }
    if (adminRoute && !auth.mfa) throw mfaRequired();
    const stepUp = this.reflector.getAllAndOverride<boolean | undefined>(STEP_UP, targets) === true;
    if (stepUp && !(await this.sessions.stepUpUntil(auth.sessionId))) throw stepUpRequired();
    return true;
  }

  /**
   * Cookie sessions are shared with the public website (COOKIE_DOMAIN), so admin routes take a
   * cookie-authenticated request only from the admin console's origin; browsers always send
   * `Origin` on cross-origin calls and pages cannot forge it (ADR-033).
   */
  private originAllowed(origin: string | undefined): boolean {
    return origin !== undefined && this.config.ADMIN_ORIGINS.includes(origin);
  }

  private ipAllowed(ip: string): boolean {
    const allowlist = this.config.ADMIN_IP_ALLOWLIST;
    if (allowlist.length === 0) return true;
    // Express may report IPv4 clients as IPv4-mapped IPv6 addresses.
    const normalised = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
    return allowlist.includes(normalised) || allowlist.includes(ip);
  }
}
