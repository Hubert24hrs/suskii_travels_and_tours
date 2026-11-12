import { z } from 'zod';

import {
  AGENT_APPROVAL_KINDS,
  AGENT_APPROVAL_REJECT_REASONS,
  AGENT_APPROVAL_STATUSES,
  AGENT_NAMES,
  PRICE_PRODUCTS,
} from '@suskii/shared';

import { promoCheck } from '../../admin/admin-promos.schemas';
import { STAFF_REFUND_REASONS } from '../../bookings/bookings.schemas';
import { named } from '../../contract/contract';
import { MAX_ITEMS } from '../../price-intel/extraction';
import { PRICED_SCHEMA_TYPES } from '../../price-intel/recipe-proposals';
import { recipeSchema } from '../../price-intel/recipes';
import { moneySchema } from '../../pricing/pricing.schemas';

const timestamp = z.iso.datetime();
const uuid = z.uuid();

/** A refund request as an agent may prepare it: which payment, how much and why, as codes. */
export const refundRequestProposalSchema = z.object({
  bookingId: uuid,
  paymentId: uuid,
  amount: moneySchema,
  reason: z.enum(STAFF_REFUND_REASONS),
  cancelBooking: z.boolean().default(false),
});
export type RefundRequestProposal = z.infer<typeof refundRequestProposalSchema>;

/** A promo code as an agent may prepare it. Whatever it says, it is created switched off. */
export const promoCodeProposalSchema = promoCheck;
export type PromoCodeProposal = z.infer<typeof promoCodeProposalSchema>;

/**
 * A recipe for one product of a site whose pages stopped reading (ADR-102), worked out by a
 * rule from the page that was kept. It names only schema.org types of our own list, and is
 * applied only while the site still has the version it replaces.
 */
export const sourceRecipeProposalSchema = z.object({
  sourceId: uuid,
  product: z.enum(PRICE_PRODUCTS),
  replaces: recipeSchema.shape.version,
  recipe: recipeSchema,
  addedTypes: z.array(z.enum(PRICED_SCHEMA_TYPES)).min(1).max(10),
  /** Priced items the proposed recipe read from the kept page. */
  itemsRead: z.number().int().min(1).max(MAX_ITEMS),
});
export type SourceRecipeProposal = z.infer<typeof sourceRecipeProposalSchema>;

export const agentApprovalParamsSchema = z.object({ approvalId: uuid });

export const agentApprovalQuerySchema = z.object({
  status: z.enum(AGENT_APPROVAL_STATUSES).default('pending'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const agentApprovalSchema = named(
  'AgentApproval',
  z.object({
    id: uuid,
    kind: z.enum(AGENT_APPROVAL_KINDS),
    status: z.enum(AGENT_APPROVAL_STATUSES),
    agent: z.enum(AGENT_NAMES),
    /** The staff member whose question produced it; they cannot decide it. */
    requestedBy: uuid,
    /** Whether the person reading may decide it: not their own, and theirs to approve by role. */
    mayDecide: z.boolean(),
    subject: z.object({ type: z.string(), id: uuid }).nullable(),
    payload: z.record(z.string(), z.unknown()).meta({
      description:
        'What would be done, as the kind states it: a refund request (payment, amount, reason), a promo code (as the promo form) or a recipe for one product of a site (the recipe, the version it replaces, the types it adds and how many priced items it read from the kept page). Approving runs the ordinary service with exactly this.',
    }),
    reason: z.string().nullable(),
    decidedBy: uuid.nullable(),
    decidedAt: timestamp.nullable(),
    result: z.object({ type: z.string(), id: uuid }).nullable(),
    expiresAt: timestamp,
    createdAt: timestamp,
  }),
);
export type AgentApprovalDto = z.infer<typeof agentApprovalSchema>;

export const agentApprovalListSchema = named(
  'AgentApprovalList',
  z.object({
    approvals: z.array(agentApprovalSchema),
    /** The other things that wait for a person, each in its own place (ADR-104). */
    alsoWaiting: z.object({
      assistedQuotesToVerify: z.number().int(),
      assistedBookingsToBook: z.number().int(),
    }),
  }),
);

export const rejectAgentApprovalSchema = named(
  'RejectAgentApproval',
  z.object({ reason: z.enum(AGENT_APPROVAL_REJECT_REASONS) }),
);
