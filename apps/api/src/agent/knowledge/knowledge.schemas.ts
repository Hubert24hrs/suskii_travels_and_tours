import { z } from 'zod';

import {
  KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_LANGUAGES,
  KNOWLEDGE_MEDIA_TYPES,
  KNOWLEDGE_TITLE_MAX,
} from '@suskii/shared';

import { named } from '../../contract/contract';

const timestamp = z.iso.datetime();
const title = z.string().trim().min(3).max(KNOWLEDGE_TITLE_MAX);

export const knowledgeDocumentSchema = named(
  'KnowledgeDocument',
  z.object({
    id: z.uuid(),
    title: z.string(),
    audience: z.enum(KNOWLEDGE_AUDIENCES),
    language: z.enum(KNOWLEDGE_LANGUAGES),
    mediaType: z.enum(KNOWLEDGE_MEDIA_TYPES),
    sizeBytes: z.number().int().min(0),
    passages: z.number().int().min(0),
    archivedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
);
export type KnowledgeDocumentDto = z.infer<typeof knowledgeDocumentSchema>;

export const knowledgeDocumentListSchema = named(
  'KnowledgeDocumentList',
  z.object({
    items: z.array(knowledgeDocumentSchema),
    /** Documents in use, and how many may be. */
    inUse: z.number().int().min(0),
    limit: z.number().int().min(1),
    maxBytes: z.number().int().min(1),
  }),
);

const passage = z.object({
  id: z.uuid(),
  position: z.number().int().min(0),
  heading: z.string().nullable(),
  body: z.string(),
});

export const knowledgeDocumentDetailSchema = named(
  'KnowledgeDocumentDetail',
  z.object({ document: knowledgeDocumentSchema, passages: z.array(passage) }),
);
export type KnowledgeDocumentDetail = z.infer<typeof knowledgeDocumentDetailSchema>;

export const knowledgeListQuerySchema = z.object({
  archived: z
    .enum(['true', 'false'])
    .default('false')
    .meta({ description: 'Documents out of use instead of those in use.' }),
});

export const knowledgeIdParamsSchema = z.object({ documentId: z.uuid() });

/** What a document is, given beside the file (the body is the file's bytes). */
export const knowledgeUploadQuerySchema = z.object({
  title,
  audience: z.enum(KNOWLEDGE_AUDIENCES),
  language: z.enum(KNOWLEDGE_LANGUAGES),
});
export type KnowledgeUpload = z.infer<typeof knowledgeUploadQuerySchema>;

/** The language is fixed with the file: its passages were indexed in it. */
export const knowledgePatchSchema = z
  .object({ title, audience: z.enum(KNOWLEDGE_AUDIENCES) })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to change' });
export type KnowledgePatch = z.infer<typeof knowledgePatchSchema>;

export const knowledgeSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  audience: z.enum(KNOWLEDGE_AUDIENCES).default('customer'),
  language: z.enum(KNOWLEDGE_LANGUAGES).default('en'),
});

export const knowledgeHitSchema = z.object({
  passageId: z.uuid(),
  documentId: z.uuid(),
  document: z.string(),
  audience: z.enum(KNOWLEDGE_AUDIENCES),
  language: z.enum(KNOWLEDGE_LANGUAGES),
  heading: z.string().nullable(),
  body: z.string(),
  updatedAt: timestamp,
});
export type KnowledgeHit = z.infer<typeof knowledgeHitSchema>;

export const knowledgeSearchSchema = named(
  'KnowledgeSearch',
  z.object({ found: z.number().int().min(0), hits: z.array(knowledgeHitSchema) }),
);
