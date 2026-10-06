import { applyDecorators, SetMetadata } from '@nestjs/common';

import type { Permission } from '@suskii/shared';

export const IS_PUBLIC = 'suskii:is-public';
export const REQUIRED_PERMISSIONS = 'suskii:required-permissions';
export const IS_ADMIN_ROUTE = 'suskii:is-admin-route';
export const STEP_UP = 'suskii:step-up';

/** Opts a controller or route out of the global deny-by-default authentication guard. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Requires every listed permission (from the role catalog in @suskii/shared). */
export const RequirePermissions = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/**
 * Admin console routes: staff role, an MFA-verified session and (when configured) an allowlisted
 * IP, on top of the listed permissions.
 */
export const AdminRoute = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(IS_ADMIN_ROUTE, true), RequirePermissions(...permissions));

/**
 * The riskiest admin actions (ADR-037): on top of `@AdminRoute`, the session must have passed an
 * authenticator check in the last STEP_UP_WINDOW_MINUTES (at sign-in or `POST /v1/auth/step-up`);
 * otherwise the route answers 403 `step-up-required`. Published as `x-step-up`.
 */
export const StepUp = (): MethodDecorator => SetMetadata(STEP_UP, true);
