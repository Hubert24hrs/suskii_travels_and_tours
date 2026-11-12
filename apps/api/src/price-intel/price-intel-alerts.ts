import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { EmailProvider } from '../notifications/email';
import { opsAlertTemplate } from '../notifications/templates';
import { priceIntelAlerts } from '../telemetry/metrics';

import type { BudgetAlert } from './price-intel-budget';

/**
 * Tells staff what price intelligence cannot decide by itself (ADR-102): a budget passing 50,
 * 80 or 100% of its cap, and a parser that stopped reading a site. Each is a warning in the
 * log, a metric, an audit entry and, when an operations mailbox is set, an email. Facts are
 * codes, amounts and a site's domain: never a question a traveller asked.
 */
@Injectable()
export class PriceIntelAlerts {
  private readonly logger = new Logger(PriceIntelAlerts.name);

  constructor(
    private readonly audit: AuditService,
    private readonly email: EmailProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async budget(alert: BudgetAlert): Promise<void> {
    priceIntelAlerts.add(1, { kind: 'budget', level: String(alert.level) });
    await this.tell('price-intel budget', 'price_intel.budget_alert', {
      scope: alert.scope,
      subject: alert.subject,
      period: alert.period,
      level: `${alert.level}%`,
      spentMicroUsd: String(alert.spentMicroUsd),
      capMicroUsd: String(alert.capMicroUsd),
    });
  }

  async drift(source: { id: string; domain: string }, parserVersion: string): Promise<void> {
    priceIntelAlerts.add(1, { kind: 'drift', level: 'opened' });
    await this.tell(
      'price-intel parser drift',
      'price_intel.drift_detected',
      { domain: source.domain, parserVersion },
      source.id,
    );
  }

  private async tell(
    kind: string,
    action: 'price_intel.budget_alert' | 'price_intel.drift_detected',
    facts: Record<string, string>,
    targetId?: string,
  ): Promise<void> {
    this.logger.warn({ kind, ...facts }, 'operations alert');
    try {
      await this.audit.record({
        action,
        actorType: 'system',
        targetType: 'price_source',
        ...(targetId ? { targetId } : {}),
        metadata: facts,
      });
      const to = this.config.OPS_ALERT_EMAIL;
      if (to) {
        await this.email.send({ to, ...opsAlertTemplate({ kind, bookingReference: null, facts }) });
      }
    } catch {
      // An alert that cannot be delivered never fails the read that caused it.
      this.logger.warn({ kind }, 'operations alert could not be delivered');
    }
  }
}
