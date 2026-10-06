import { Inject, Injectable, Logger } from '@nestjs/common';

import { NEWSLETTER_CONSENT_VERSION } from '@suskii/shared';

import { invalidOrExpiredLink } from '../auth/errors';
import { botCheckFailed } from '../bot-protection/errors';
import { TurnstileVerifier } from '../bot-protection/turnstile';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { HmacService } from '../crypto/hmac.service';
import { randomToken, sha256 } from '../crypto/random';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { EmailProvider } from '../notifications/email';
import { newsletterConfirmTemplate } from '../notifications/templates';

import type { SubscribeRequest } from './newsletter.schemas';

const CONFIRM_TTL_MS = 48 * 3_600_000;
/** A pending subscription gets at most one new confirmation email per window. */
const RESEND_AFTER_MS = 10 * 60_000;

/**
 * Deal-alert subscriptions with double opt-in and a provable consent record (ADR-012). Every
 * valid request gets the same answer, and emails are sent off the request path, so neither the
 * response nor its timing reveals whether an address is subscribed.
 */
@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly hmac: HmacService,
    private readonly turnstile: TurnstileVerifier,
    private readonly email: EmailProvider,
  ) {}

  async subscribe(
    input: SubscribeRequest,
    ip: string | undefined,
    now = new Date(),
  ): Promise<void> {
    if (
      !(await this.turnstile.verify(input.turnstileToken, { remoteIp: ip, action: 'newsletter' }))
    )
      throw botCheckFailed();

    const existing = await this.prisma.newsletterSubscription.findUnique({
      where: { email: input.email },
    });
    if (existing?.status === 'confirmed') return;
    if (
      existing?.status === 'pending' &&
      existing.confirmationSentAt &&
      now.getTime() - existing.confirmationSentAt.getTime() < RESEND_AFTER_MS
    )
      return;

    const token = randomToken();
    const data = {
      status: 'pending' as const,
      locale: input.locale,
      whatsappPhone: input.whatsapp?.phone ?? null,
      whatsappStatus: input.whatsapp ? ('pending_verification' as const) : null,
      consentVersion: NEWSLETTER_CONSENT_VERSION,
      consentedAt: now,
      consentIpHash: ip ? this.hmac.digest('ip', ip) : null,
      source: 'homepage',
      confirmTokenHash: sha256(token),
      confirmTokenExpiresAt: new Date(now.getTime() + CONFIRM_TTL_MS),
      confirmationSentAt: now,
      confirmedAt: null,
    };
    let subscriptionId: string;
    try {
      const saved = await this.prisma.newsletterSubscription.upsert({
        where: { email: input.email },
        create: { email: input.email, ...data },
        update: data,
        select: { id: true },
      });
      subscriptionId = saved.id;
    } catch (error) {
      // Two identical sign-ups raced; the other one sends the email.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }

    const base = this.config.WEB_APP_URL.replace(/\/$/, '');
    const message = newsletterConfirmTemplate(
      `${base}/newsletter/confirm#token=${token}`,
      `${base}/newsletter/unsubscribe#token=${this.unsubscribeToken(subscriptionId)}`,
    );
    this.email.send({ ...message, to: input.email }).catch((error: unknown) => {
      this.logger.error({ err: (error as Error).name }, 'newsletter confirmation email failed');
    });
  }

  /** Idempotent until the link expires: a second click still answers "confirmed". */
  async confirm(token: string, now = new Date()): Promise<void> {
    const subscription = await this.prisma.newsletterSubscription.findUnique({
      where: { confirmTokenHash: sha256(token) },
    });
    if (
      !subscription ||
      subscription.status === 'unsubscribed' ||
      !subscription.confirmTokenExpiresAt ||
      subscription.confirmTokenExpiresAt <= now
    )
      throw invalidOrExpiredLink();
    if (subscription.status === 'confirmed') return;
    await this.prisma.newsletterSubscription.update({
      where: { id: subscription.id },
      data: { status: 'confirmed', confirmedAt: now },
    });
  }

  async unsubscribe(token: string, now = new Date()): Promise<void> {
    const [id, digest] = token.split('.');
    if (!id || !digest || !this.hmac.verify('newsletter', `unsubscribe:${id}`, digest))
      throw invalidOrExpiredLink();
    const { count } = await this.prisma.newsletterSubscription.updateMany({
      where: { id, status: { not: 'unsubscribed' } },
      data: { status: 'unsubscribed', unsubscribedAt: now, whatsappStatus: null },
    });
    if (count === 0 && !(await this.prisma.newsletterSubscription.findUnique({ where: { id } })))
      throw invalidOrExpiredLink();
  }

  /** Stateless, permanent unsubscribe token: `<subscription id>.<keyed digest>`. */
  unsubscribeToken(subscriptionId: string): string {
    return `${subscriptionId}.${this.hmac.digest('newsletter', `unsubscribe:${subscriptionId}`)}`;
  }
}
