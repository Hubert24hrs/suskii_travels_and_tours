import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute, StepUp } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { staffActor } from './admin-helpers';
import { AdminUsersService } from './admin-users.service';
import {
  adminUserPageSchema,
  adminUserQuerySchema,
  adminUserSchema,
  revokedSessionsSchema,
  setRolesBodySchema,
  userIdParamsSchema,
} from './admin.schemas';

type AdminUser = z.infer<typeof adminUserSchema>;
const TAGS = ['Admin'];

@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @AdminRoute('users:read')
  @Contract({
    operationId: 'adminListUsers',
    summary: 'Search accounts (newest first)',
    tags: TAGS,
    query: adminUserQuerySchema,
    responses: { 200: adminUserPageSchema },
    errors: [403],
  })
  list(
    @Query() query: z.infer<typeof adminUserQuerySchema>,
  ): Promise<z.infer<typeof adminUserPageSchema>> {
    return this.users.list(query);
  }

  @Get(':id')
  @AdminRoute('users:read')
  @Contract({
    operationId: 'adminGetUser',
    summary: 'Get a user',
    tags: TAGS,
    params: userIdParamsSchema,
    responses: { 200: adminUserSchema },
    errors: [403, 404],
  })
  getUser(@Param('id') id: string): Promise<AdminUser> {
    return this.users.get(id);
  }

  @Put(':id/roles')
  @AdminRoute('roles:manage')
  @StepUp()
  @Contract({
    operationId: 'adminSetUserRoles',
    audit: ['rbac.roles.changed'],
    summary: "Replace a user's roles",
    description: 'Audited. Signs the user out everywhere so the new roles apply immediately.',
    tags: TAGS,
    params: userIdParamsSchema,
    body: setRolesBodySchema,
    responses: { 200: adminUserSchema },
    errors: [403, 404, 409],
  })
  setRoles(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof setRolesBodySchema>,
    @Req() request: Request,
  ): Promise<AdminUser> {
    return this.users.setRoles(id, body.roles, staffActor(auth, request));
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('users:manage')
  @StepUp()
  @Contract({
    operationId: 'adminDisableUser',
    summary: 'Disable an account and sign it out everywhere',
    tags: TAGS,
    params: userIdParamsSchema,
    responses: { 200: adminUserSchema },
    errors: [403, 404, 409],
    audit: ['user.disabled'],
  })
  disable(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<AdminUser> {
    return this.users.setStatus(id, 'disabled', staffActor(auth, request));
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('users:manage')
  @Contract({
    operationId: 'adminEnableUser',
    summary: 'Enable a disabled account',
    tags: TAGS,
    params: userIdParamsSchema,
    responses: { 200: adminUserSchema },
    errors: [403, 404, 409],
    audit: ['user.enabled'],
  })
  enable(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<AdminUser> {
    return this.users.setStatus(id, 'active', staffActor(auth, request));
  }

  @Post(':id/mfa-reset')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('users:manage')
  @StepUp()
  @Contract({
    operationId: 'adminResetUserMfa',
    summary: "Remove an account's authenticator so the user enrols again",
    description: 'Also removes recovery codes and signs the user out everywhere.',
    tags: TAGS,
    params: userIdParamsSchema,
    responses: { 200: adminUserSchema },
    errors: [403, 404, 409],
    audit: ['user.mfa_reset'],
  })
  resetMfa(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<AdminUser> {
    return this.users.resetMfa(id, staffActor(auth, request));
  }

  @Post(':id/sessions/revoke')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('users:manage')
  @Contract({
    operationId: 'adminRevokeUserSessions',
    summary: 'Sign an account out on every device',
    description:
      'For a lost device or a suspected takeover; the account stays active and can sign in again.',
    tags: TAGS,
    params: userIdParamsSchema,
    responses: { 200: revokedSessionsSchema },
    errors: [403, 404, 409],
    audit: ['user.sessions_revoked'],
  })
  revokeSessions(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<z.infer<typeof revokedSessionsSchema>> {
    return this.users.revokeSessions(id, staffActor(auth, request));
  }
}
