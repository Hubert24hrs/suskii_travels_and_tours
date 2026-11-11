import { z } from 'zod';

import {
  AGENT_APPROVAL_KINDS,
  AGENT_APPROVAL_REJECT_REASONS,
  AGENT_APPROVAL_STATUSES,
  AGENT_NAMES,
} from '@suskii/shared';

import { promoCheck } from '../../admin/admin-promos.schemas';
import { STAFF_REFUND_REASONS } from '../../bookings/bookings.schemas';
import { named } from '../../contract/contract';
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
        'What would be done, as the kind states it: a refund request (payment, amount, reason) or a promo code (as the promo form). Approving runs the ordinary service with exactly this.',
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
