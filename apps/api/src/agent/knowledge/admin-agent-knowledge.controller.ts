import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import { KNOWLEDGE_MAX_BYTES, KNOWLEDGE_MEDIA_TYPES } from '@suskii/shared';

import { staffActor } from '../../admin/admin-helpers';
import { CurrentAuth, type AuthContext } from '../../auth/auth-context';
import { AdminRoute } from '../../auth/decorators';
import { Contract, fileResponse } from '../../contract/contract';
import { readUpload } from '../../visa/upload-body';

import {
  knowledgeDocumentDetailSchema,
  knowledgeDocumentListSchema,
  knowledgeDocumentSchema,
  knowledgeIdParamsSchema,
  knowledgeListQuerySchema,
  knowledgePatchSchema,
  knowledgeSearchQuerySchema,
  knowledgeSearchSchema,
  knowledgeUploadQuerySchema,
  type KnowledgeDocumentDetail,
  type KnowledgeDocumentDto,
  type KnowledgePatch,
  type KnowledgeUpload,
} from './knowledge.schemas';
import { KnowledgeService, knowledgeTooLarge, knowledgeWrongType } from './knowledge.service';

const TAGS = ['Admin'];
const UPLOAD_RULES = {
  types: KNOWLEDGE_MEDIA_TYPES,
  tooLarge: knowledgeTooLarge,
  wrongType: knowledgeWrongType,
};

/**
 * The knowledge base in the console (ADR-105): the documents the assistant answers from.
 * Reading needs `ai:read`; adding, changing and archiving need `ai:manage` and are audited.
 * Nothing is deleted: a document out of use is archived and can be put back.
 */
@Controller('admin/ai/knowledge')
export class AdminAgentKnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminListKnowledge',
    summary: 'Documents of the knowledge base, newest change first',
    tags: TAGS,
    query: knowledgeListQuerySchema,
    responses: { 200: knowledgeDocumentListSchema },
    errors: [403],
  })
  list(
    @Query() query: z.infer<typeof knowledgeListQuerySchema>,
  ): Promise<z.infer<typeof knowledgeDocumentListSchema>> {
    return this.knowledge.list(query.archived === 'true');
  }

  @Get('search')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminSearchKnowledge',
    summary: 'What the assistant would find for a question',
    description:
      'The same search the assistant runs, for an audience and a language: the passages that match best, from documents in use. Staff see what travellers would be answered from before relying on it.',
    tags: TAGS,
    query: knowledgeSearchQuerySchema,
    responses: { 200: knowledgeSearchSchema },
    errors: [403],
  })
  async search(
    @Query() query: z.infer<typeof knowledgeSearchQuerySchema>,
  ): Promise<z.infer<typeof knowledgeSearchSchema>> {
    // A staff answer may draw on what travellers are told as well.
    const audiences =
      query.audience === 'staff' ? (['staff', 'customer'] as const) : (['customer'] as const);
    const hits = await this.knowledge.search(query.q, audiences, query.language, 8);
    return { found: hits.length, hits };
  }

  @Post()
  @AdminRoute('ai:manage')
  @Contract({
    operationId: 'adminAddKnowledge',
    summary: 'Add a document to the knowledge base',
    description:
      'Raw body: plain text or Markdown in UTF-8, at most 512 KB, with its title, audience and language in the query. The file is virus-scanned, split into passages at its headings and searchable at once. Company text only: nothing about a person belongs in it. 409 `knowledge-duplicate` for the same file in the same audience and language, `knowledge-full` at the limit.',
    tags: TAGS,
    query: knowledgeUploadQuerySchema,
    upload: { contentTypes: KNOWLEDGE_MEDIA_TYPES, description: 'The document.' },
    responses: { 201: knowledgeDocumentSchema },
    audit: ['agent.knowledge_added'],
    errors: [403, 409, 413, 415, 422, 503],
  })
  async add(
    @CurrentAuth() auth: AuthContext,
    @Query() query: KnowledgeUpload,
    @Req() request: Request,
  ): Promise<KnowledgeDocumentDto> {
    const bytes = await readUpload(request, KNOWLEDGE_MAX_BYTES, UPLOAD_RULES);
    const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    return this.knowledge.add(query, type, bytes, staffActor(auth, request));
  }

  @Get(':documentId')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminGetKnowledge',
    summary: 'A document and its passages, as the assistant reads them',
    tags: TAGS,
    params: knowledgeIdParamsSchema,
    responses: { 200: knowledgeDocumentDetailSchema },
    errors: [403, 404],
  })
  get(@Param('documentId') documentId: string): Promise<KnowledgeDocumentDetail> {
    return this.knowledge.get(documentId);
  }

  @Get(':documentId/content')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminGetKnowledgeContent',
    summary: 'The file as it was uploaded',
    tags: TAGS,
    params: knowledgeIdParamsSchema,
    responses: { 200: fileResponse('text/plain') },
    errors: [403, 404],
  })
  async content(
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.knowledge.content(documentId);
    // Never rendered or run by a browser: an attachment, no sniffing, sandboxed if opened anyway.
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file.bytes, {
      type: file.contentType,
      disposition: `attachment; filename="${file.name}"`,
      length: file.bytes.byteLength,
    });
  }

  @Patch(':documentId')
  @AdminRoute('ai:manage')
  @Contract({
    operationId: 'adminChangeKnowledge',
    summary: "Change a document's title or audience",
    description:
      'The language and the text stay as uploaded: add the new version and archive the old one.',
    tags: TAGS,
    params: knowledgeIdParamsSchema,
    body: knowledgePatchSchema,
    responses: { 200: knowledgeDocumentSchema },
    audit: ['agent.knowledge_changed'],
    errors: [403, 404],
  })
  change(
    @CurrentAuth() auth: AuthContext,
    @Param('documentId') documentId: string,
    @Body() body: KnowledgePatch,
    @Req() request: Request,
  ): Promise<KnowledgeDocumentDto> {
    return this.knowledge.change(documentId, body, staffActor(auth, request));
  }

  @Post(':documentId/archive')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('ai:manage')
  @Contract({
    operationId: 'adminArchiveKnowledge',
    summary: 'Take a document out of use',
    description: 'The assistant stops answering from it at once. Nothing is deleted.',
    tags: TAGS,
    params: knowledgeIdParamsSchema,
    responses: { 200: knowledgeDocumentSchema },
    audit: ['agent.knowledge_archived'],
    errors: [403, 404, 409],
  })
  archive(
    @CurrentAuth() auth: AuthContext,
    @Param('documentId') documentId: string,
    @Req() request: Request,
  ): Promise<KnowledgeDocumentDto> {
    return this.knowledge.setArchived(documentId, true, staffActor(auth, request));
  }

  @Post(':documentId/restore')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('ai:manage')
  @Contract({
    operationId: 'adminRestoreKnowledge',
    summary: 'Put an archived document back in use',
    tags: TAGS,
    params: knowledgeIdParamsSchema,
    responses: { 200: knowledgeDocumentSchema },
    audit: ['agent.knowledge_restored'],
    errors: [403, 404, 409],
  })
  restore(
    @CurrentAuth() auth: AuthContext,
    @Param('documentId') documentId: string,
    @Req() request: Request,
  ): Promise<KnowledgeDocumentDto> {
    return this.knowledge.setArchived(documentId, false, staffActor(auth, request));
  }
}
