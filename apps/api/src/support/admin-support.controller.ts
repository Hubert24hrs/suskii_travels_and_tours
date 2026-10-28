import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { staffActor } from '../admin/admin-helpers';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { Contract, named } from '../contract/contract';

import { SupportAdminService } from './support-admin.service';
import {
  adminSupportConversationSchema,
  adminSupportPageSchema,
  adminSupportParamsSchema,
  adminSupportQuerySchema,
  adminSupportReplySchema,
  adminSupportUpdateSchema,
} from './support.schemas';

const TAGS = ['Admin'];
type AdminConversation = z.infer<typeof adminSupportConversationSchema>;

const supportAgentsSchema = named(
  'AdminSupportAgents',
  z.object({ agents: z.array(z.object({ id: z.uuid(), name: z.string() })) }),
);

/** The support inbox (ADR-083): queues with SLA timers, replies, notes and assignment. */
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly support: SupportAdminService) {}

  @Get('conversations')
  @AdminRoute('support:manage')
  @Contract({
    operationId: 'adminListSupportConversations',
    summary: 'Support conversations by queue (open and waiting ones nearest due first)',
    tags: TAGS,
    query: adminSupportQuerySchema,
    responses: { 200: adminSupportPageSchema },
    errors: [403],
  })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: z.infer<typeof adminSupportQuerySchema>,
  ): Promise<z.infer<typeof adminSupportPageSchema>> {
    return this.support.list(query, auth.userId);
  }

  @Get('agents')
  @AdminRoute('support:manage')
  @Contract({
    operationId: 'adminListSupportAgents',
    summary: 'Staff members who can be assigned support conversations',
    tags: TAGS,
    responses: { 200: supportAgentsSchema },
    errors: [403],
  })
  agents(): Promise<z.infer<typeof supportAgentsSchema>> {
    return this.support.agents();
  }

  @Get('conversations/:id')
  @AdminRoute('support:manage')
  @Contract({
    operationId: 'adminGetSupportConversation',
    summary: 'A support conversation with every message and internal note',
    tags: TAGS,
    params: adminSupportParamsSchema,
    responses: { 200: adminSupportConversationSchema },
    errors: [403, 404],
  })
  get(@Param('id') id: string): Promise<AdminConversation> {
    return this.support.get(id);
  }

  @Post('conversations/:id/messages')
  @AdminRoute('support:manage')
  @Contract({
    operationId: 'adminReplySupportConversation',
    summary: 'Reply to the traveller, or add an internal note',
    description:
      'A reply stops the response clock, waits for the traveller and tells them by email or push (never with the text). Unassigned conversations are assigned to whoever replies.',
    tags: TAGS,
    params: adminSupportParamsSchema,
    body: adminSupportReplySchema,
    responses: { 201: adminSupportConversationSchema },
    errors: [403, 404, 409],
    audit: ['support.replied', 'support.note_added'],
  })
  reply(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof adminSupportReplySchema>,
    @Req() request: Request,
  ): Promise<AdminConversation> {
    return this.support.reply(id, body, staffActor(auth, request));
  }

  @Patch('conversations/:id')
  @AdminRoute('support:manage')
  @Contract({
    operationId: 'adminUpdateSupportConversation',
    summary: 'Change status, priority, category or assignee',
    description:
      'Due times are recomputed from the new priority. 422 `support-assignee-invalid` for someone who does not handle support.',
    tags: TAGS,
    params: adminSupportParamsSchema,
    body: adminSupportUpdateSchema,
    responses: { 200: adminSupportConversationSchema },
    errors: [403, 404, 422],
    audit: ['support.updated'],
  })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof adminSupportUpdateSchema>,
    @Req() request: Request,
  ): Promise<AdminConversation> {
    return this.support.update(id, body, staffActor(auth, request));
  }
}
