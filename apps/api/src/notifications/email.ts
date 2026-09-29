import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { APP_CONFIG, type AppConfig } from '../config/config';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Template name for logs and metrics; the recipient and body are never logged. */
  template: string;
}

export abstract class EmailProvider {
  abstract send(message: EmailMessage): Promise<void>;
}

/** SMTP delivery: Mailpit locally, the transactional provider's SMTP relay in production. */
@Injectable()
export class SmtpEmailProvider extends EmailProvider {
  private readonly logger = new Logger(SmtpEmailProvider.name);
  private readonly transport: Transporter;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
    this.transport = createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      ...(config.SMTP_USER && config.SMTP_PASSWORD
        ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } }
        : {}),
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.config.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    this.logger.log({ template: message.template }, 'email sent');
  }
}

/** Mock adapter for tests and offline development: keeps messages in memory, sends nothing. */
@Injectable()
export class MockEmailProvider extends EmailProvider {
  private readonly logger = new Logger(MockEmailProvider.name);
  readonly outbox: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.outbox.push(message);
    this.logger.log({ template: message.template }, 'email captured by mock provider');
    return Promise.resolve();
  }
}
