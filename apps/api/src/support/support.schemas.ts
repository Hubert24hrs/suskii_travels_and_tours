import { z } from 'zod';

import {
  SUPPORT_AUTHORS,
  SUPPORT_CATEGORIES,
  SUPPORT_CHANNELS,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  supportMessageTextSchema,
  supportReplySchema,
  supportStartSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';

const timestamp = z.iso.datetime();

export const SUPPORT_TOKEN_HEADER = {
  name: 'X-Support-Token',
  required: false,
  description:
    'Guests: the access token returned when the conversation started, or the link token from a reply email. Account holders use their session instead.',
};

/** Newest messages a conversation answers with when no `after` is given. */
export const SUPPORT_PAGE_MESSAGES = 200;

const bookingRefSchema = z
  .object({ id: z.uuid(), reference: z.string() })
  .nullable()
  .meta({ description: 'The booking the conversation is about, if any.' });

/** A message as the traveller sees it: who wrote it (never which staff member) and the text. */
export const supportMessageSchema = named(
  'SupportMessage',
  z.object({
    id: z.uuid(),
    author: z.enum(SUPPORT_AUTHORS),
    text: z.string(),
    createdAt: timestamp,
  }),
);

const conversationFields = {
  id: z.uuid(),
  reference: z.string(),
  category: z.enum(SUPPORT_CATEGORIES),
  status: z.enum(SUPPORT_STATUSES),
  booking: bookingRefSchema,
  lastMessageAt: timestamp,
  unread: z.boolean().meta({ description: 'A staff reply arrived after the traveller last read.' }),
  createdAt: timestamp,
};

export const supportConversationSummarySchema = named(
  'SupportConversationSummary',
  z.object(conversationFields),
);

export const supportConversationSchema = named(
  'SupportConversation',
  z.object({
    ...conversationFields,
    messages: z.array(supportMessageSchema).meta({
      description: `Oldest first: messages after \`after\`, or the newest ${SUPPORT_PAGE_MESSAGES}.`,
    }),
  }),
);

export const supportConversationListSchema = named(
  'SupportConversationList',
  z.object({ conversations: z.array(supportConversationSummarySchema) }),
);

export const startSupportSchema = named(
  'StartSupportConversationRequest',
  supportStartSchema.extend({
    turnstileToken: z.string().min(1).max(2048).nullable().default(null).meta({
      description:
        'Cloudflare Turnstile token (action `support`); required on the website without a session. The app sends a device attestation instead.',
    }),
  }),
);

export const startedSupportSchema = named(
  'StartedSupportConversation',
  z.object({
    conversation: supportConversationSchema,
    accessToken: z.string().nullable().meta({
      description:
        'Guests only, shown once: send it as `X-Support-Token` to read and reply. Null for account holders.',
    }),
  }),
);

export const supportReplyRequestSchema = named('SupportReplyRequest', supportReplySchema);

export const supportParamsSchema = z.object({ conversationId: z.uuid() });

export const supportConversationQuerySchema = z.object({
  after: z.uuid().optional().meta({
    description: 'Only messages newer than this message id (polling for new messages).',
  }),
});

// ---------------------------------------------------------------------------
// Console (ADR-083)
// ---------------------------------------------------------------------------

export const SUPPORT_QUEUES = ['active', 'open', 'waiting', 'resolved'] as const;
export const SUPPORT_ASSIGNEE_FILTERS = ['any', 'me', 'unassigned'] as const;

const slaSchema = z.object({
  state: z.enum(['met', 'on_track', 'due_soon', 'breached']),
  responseDueAt: timestamp.nullable(),
  resolutionDueAt: timestamp.nullable(),
});

const adminConversationFields = {
  id: z.uuid(),
  reference: z.string(),
  category: z.enum(SUPPORT_CATEGORIES),
  priority: z.enum(SUPPORT_PRIORITIES),
  status: z.enum(SUPPORT_STATUSES),
  channel: z.enum(SUPPORT_CHANNELS),
  customer: z.object({
    userId: z.uuid().nullable(),
    /** The account's display name, else a masked email. */
    label: z.string(),
    guest: z.boolean(),
  }),
  booking: bookingRefSchema,
  assignee: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  sla: slaSchema,
  awaitingReply: z.boolean().meta({ description: 'The traveller wrote last.' }),
  messageCount: z.number().int(),
  lastCustomerMessageAt: timestamp,
  lastStaffMessageAt: timestamp.nullable(),
  firstRespondedAt: timestamp.nullable(),
  createdAt: timestamp,
};

export const adminSupportRowSchema = named(
  'AdminSupportConversationRow',
  z.object(adminConversationFields),
);

export const adminSupportPageSchema = named(
  'AdminSupportConversationPage',
  z.object({ items: z.array(adminSupportRowSchema), nextCursor: z.string().nullable() }),
);

export const adminSupportMessageSchema = named(
  'AdminSupportMessage',
  z.object({
    id: z.uuid(),
    author: z.enum(SUPPORT_AUTHORS),
    internal: z.boolean(),
    staff: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    text: z.string(),
    createdAt: timestamp,
  }),
);

export const adminSupportConversationSchema = named(
  'AdminSupportConversation',
  z.object({ ...adminConversationFields, messages: z.array(adminSupportMessageSchema) }),
);

export const adminSupportQuerySchema = z.object({
  queue: z.enum(SUPPORT_QUEUES).default('active').meta({
    description:
      '`active` is open and waiting conversations, nearest due first; `resolved` is newest first.',
  }),
  priority: z.enum(SUPPORT_PRIORITIES).optional(),
  assignee: z.enum(SUPPORT_ASSIGNEE_FILTERS).default('any'),
  cursor: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminSupportParamsSchema = z.object({ id: z.uuid() });

export const adminSupportReplySchema = named(
  'AdminSupportReplyRequest',
  z.object({
    message: supportMessageTextSchema,
    internal: z.boolean().default(false).meta({
      description: 'An internal note: staff only, never shown or sent to the traveller.',
    }),
  }),
);

export const adminSupportUpdateSchema = named(
  'AdminSupportUpdateRequest',
  z
    .object({
      status: z.enum(SUPPORT_STATUSES).optional(),
      priority: z.enum(SUPPORT_PRIORITIES).optional(),
      category: z.enum(SUPPORT_CATEGORIES).optional(),
      assigneeId: z.uuid().nullable().optional().meta({
        description: 'A staff member who handles support, or null to unassign.',
      }),
    })
    .refine((body) => Object.values(body).some((value) => value !== undefined), {
      message: 'nothing_to_change',
    }),
);
