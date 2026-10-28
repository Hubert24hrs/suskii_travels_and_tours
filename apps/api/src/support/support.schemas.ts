import { z } from 'zod';

import {
  SUPPORT_AUTHORS,
  SUPPORT_CATEGORIES,
  SUPPORT_CHANNELS,
  SUPPORT_DELIVERY_STATUSES,
  SUPPORT_MESSAGE_KINDS,
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
    author: z.enum(SUPPORT_AUTHORS).meta({
      description: '`assistant`: an automated answer from the after-hours assistant (ADR-085).',
    }),
    kind: z.enum(SUPPORT_MESSAGE_KINDS).meta({
      description:
        "`handover`: the assistant says the team is offline and a person will reply; show it in the traveller's language (`text` is the English).",
    }),
    text: z.string(),
    createdAt: timestamp,
  }),
);

/** What an assistant answer cited, for staff (ADR-085). */
const assistantSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('faq'), id: z.uuid(), question: z.string() }),
  z.object({ kind: z.literal('fact'), key: z.string() }),
]);
export const assistantSourcesSchema = z.array(assistantSourceSchema);

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
  whatsapp: z
    .object({
      /** When free-form replies stop (24 hours after their last message); null when closed. */
      windowClosesAt: timestamp.nullable(),
      /** They wrote STOP: replies outside the window are not sent. */
      optedOut: z.boolean(),
      /** False for a username user without a phone number (replies cannot be sent yet). */
      reachable: z.boolean(),
    })
    .nullable()
    .meta({ description: 'WhatsApp conversations only (ADR-084).' }),
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
    kind: z.enum(SUPPORT_MESSAGE_KINDS).meta({
      description:
        '`unsupported`: a WhatsApp attachment; `text` holds its type ("image"). `handover`: the assistant left the conversation to people.',
    }),
    text: z.string(),
    sources: assistantSourcesSchema.nullable().meta({
      description:
        'Assistant answers: the FAQs and booking fact keys the answer rested on (ADR-085).',
    }),
    delivery: z
      .object({
        status: z.enum(SUPPORT_DELIVERY_STATUSES),
        error: z.string().nullable(),
        noticeSentAt: timestamp.nullable(),
      })
      .nullable()
      .meta({ description: 'Staff replies sent over WhatsApp only.' }),
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
  channel: z.enum(SUPPORT_CHANNELS).optional(),
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

/** Meta's webhook handshake (ADR-084); the challenge is echoed only when the token matches. */
export const whatsappHandshakeQuerySchema = z.object({
  'hub.mode': z.literal('subscribe'),
  'hub.verify_token': z.string().min(1).max(200),
  'hub.challenge': z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
});

export const whatsappReceiptSchema = named(
  'WhatsAppWebhookReceipt',
  z.object({ received: z.literal(true) }),
);
