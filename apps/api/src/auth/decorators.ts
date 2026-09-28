import { SetMetadata } from '@nestjs/common';

import type { Permission } from '@suskii/shared';

export const IS_PUBLIC = 'suskii:is-public';
export const REQUIRED_PERMISSIONS = 'suskii:required-permissions';

/** Opts a controller or route out of the global deny-by-default authentication guard. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Requires every listed permission (from the role catalog in @suskii/shared). */
export const RequirePermissions = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_PERMISSIONS, permissions);
