import { Injectable, Logger } from '@nestjs/common';

import type { RequestContext } from '../common/request-context';
import { HmacService } from '../crypto/hmac.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

/** Every audited event. Adding one here is the only way to write it. */
export type AuditAction =
  | 'auth.registered'
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'auth.login.locked'
  | 'auth.mfa.challenge_failed'
  | 'auth.mfa.enabled'
  | 'auth.mfa.disabled'
  | 'auth.mfa.recovery_code_used'
  | 'auth.mfa.recovery_codes_regenerated'
  | 'auth.otp.failed'
  | 'auth.refresh_token.reused'
  | 'auth.session.revoked'
  | 'auth.session.evicted'
  | 'auth.sessions.revoked_all'
  | 'auth.sessions.revoked_incident'
  | 'auth.step_up.succeeded'
  | 'auth.logout'
  | 'auth.password.changed'
  | 'auth.password.reset'
  | 'auth.email.verified'
  | 'auth.phone.verified'
  | 'auth.social.linked'
  | 'rbac.roles.changed'
  | 'rbac.access_denied'
  | 'booking.created'
  | 'booking.status_changed'
  | 'booking.price_changed'
  | 'booking.price_consented'
  | 'booking.ticketing_failed'
  | 'booking.held'
  | 'booking.plan_defaulted'
  | 'booking.plan_cancelled'
  | 'payment.created'
  | 'payment.amount_mismatch'
  | 'payment.requires_refund'
  | 'payment.wallet'
  | 'payment.reconciled'
  | 'payment_risk.held'
  | 'payment_risk.approved'
  | 'payment_risk.rejected'
  | 'payment_plan.created'
  | 'refund.created'
  | 'refund.approved'
  | 'refund.rejected'
  | 'refund.succeeded'
  | 'refund.failed'
  | 'refund.needs_review'
  | 'refund.resolved'
  | 'traveller.created'
  | 'traveller.updated'
  | 'traveller.deleted'
  | 'booking.cancelled_under_policy'
  | 'booking.voucher_redeemed'
  | 'booking.addon_link_issued'
  | 'catalog.created'
  | 'catalog.updated'
  | 'catalog.status_changed'
  | 'catalog.departure_created'
  | 'catalog.departure_updated'
  | 'visa.rule_upserted'
  | 'visa.rule_deleted'
  | 'visa.application_opened'
  | 'visa.application_submitted'
  | 'visa.application_status_changed'
  | 'visa.application_message'
  | 'visa.application_note'
  | 'visa.document_uploaded'
  | 'visa.document_scanned'
  | 'visa.document_rejected'
  | 'visa.document_link_issued'
  | 'visa.document_accessed'
  | 'visa.documents_pruned'
  | 'account.data_exported'
  | 'account.reauth_failed'
  | 'user.deleted'
  | 'prime.plan_created'
  | 'prime.plan_updated'
  | 'prime.membership_started'
  | 'referral.attributed'
  | 'referral.qualified'
  | 'referral.rewarded'
  | 'referral.reviewed'
  | 'reminder.checkin_sent'
  | 'reminder.prime_sent'
  | 'retention.swept'
  | 'booking.note_added'
  | 'booking.contact_revealed'
  | 'booking.confirmation_resent'
  | 'user.disabled'
  | 'user.enabled'
  | 'user.mfa_reset'
  | 'user.sessions_revoked'
  | 'pricing.markup_created'
  | 'pricing.markup_updated'
  | 'pricing.fee_created'
  | 'pricing.fee_updated'
  | 'promo.created'
  | 'promo.updated'
  | 'deals.route_created'
  | 'deals.route_updated'
  | 'destination.created'
  | 'destination.updated'
  | 'cms.block_saved'
  | 'cms.faq_created'
  | 'cms.faq_updated'
  | 'trust_signal.updated'
  | 'trust_signal.verified'
  | 'trust_signal.unverified'
  // Cars (ADR-049 to ADR-053)
  | 'ground.operator_created'
  | 'ground.operator_updated'
  | 'ground.terminal_created'
  | 'ground.terminal_updated'
  | 'ground.route_created'
  | 'ground.route_updated'
  | 'ground.layout_created'
  | 'ground.layout_updated'
  | 'ground.trip_created'
  | 'ground.trips_scheduled'
  | 'ground.trip_updated'
  | 'ground.trip_cancelled'
  | 'ground.agent_added'
  | 'ground.agent_removed'
  | 'bus.ticket_boarded'
  | 'bus.ticket_scan_conflict'
  | 'ride.fare_rule_saved'
  | 'ride.place_created'
  | 'ride.place_updated'
  | 'ride.cancelled'
  | 'ride.completed'
  | 'ride.pin_locked'
  | 'ride.share_created'
  | 'ride.share_revoked'
  | 'ride.sos_raised'
  | 'ride.staff_cancelled'
  | 'driver.applied'
  | 'driver.document_uploaded'
  | 'driver.document_reviewed'
  | 'driver.document_accessed'
  | 'driver.vehicle_added'
  | 'driver.vehicle_reviewed'
  | 'driver.approved'
  | 'driver.rejected'
  | 'driver.suspended'
  | 'driver.reinstated'
  | 'driver.payout_account_updated'
  | 'driver.payout_sent'
  | 'driver.payout_failed'
  | 'safety.incident_acknowledged'
  | 'safety.incident_resolved'
  | 'rental.vehicle_created'
  | 'rental.vehicle_updated'
  | 'rental.checked_out'
  | 'rental.checked_in'
  | 'rental.deposit_released'
  | 'rental.licence_submitted'
  | 'rental.licence_uploaded'
  | 'rental.licence_reviewed'
  | 'rental.licence_accessed'
  | 'rental.photo_uploaded'
  | 'rental.photo_accessed'
  | 'account.emergency_contacts_updated';

export interface AuditEvent {
  action: AuditAction;
  /** Omit for anonymous actors (e.g. a failed login for an unknown account). */
  actorUserId?: string | null;
  actorType?: 'user' | 'system' | 'anonymous';
  targetType?: string;
  targetId?: string;
  context?: RequestContext;
  /** Identifiers and reasons only. Never PII, credentials or tokens. */
  metadata?: Prisma.InputJsonObject;
}

type AuditWriter = Pick<PrismaService, 'auditLog'>;

/**
 * Writes the append-only audit log (UPDATE and DELETE are rejected by a database trigger). IPs
 * are stored as keyed hashes. Pass a transaction client to make the record atomic with the change.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hmac: HmacService,
  ) {}

  async record(event: AuditEvent, writer: AuditWriter = this.prisma): Promise<void> {
    const actorType = event.actorType ?? (event.actorUserId ? 'user' : 'anonymous');
    await writer.auditLog.create({
      data: {
        action: event.action,
        actorType,
        actorUserId: event.actorUserId ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        requestId: event.context?.requestId ?? null,
        ipHash: event.context ? this.hmac.digest('ip', event.context.ip) : null,
        userAgent: event.context?.userAgent ?? null,
        metadata: event.metadata ?? {},
      },
    });
    this.logger.log({ audit: event.action, targetType: event.targetType }, 'audit event');
  }
}
