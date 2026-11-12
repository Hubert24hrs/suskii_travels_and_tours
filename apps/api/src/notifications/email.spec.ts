import { smtpTransportOptions } from './email';

const settings = {
  NODE_ENV: 'production' as const,
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_ALLOW_PLAINTEXT: false,
  SMTP_USER: undefined,
  SMTP_PASSWORD: undefined,
};

describe('smtpTransportOptions (ADR-038, ADR-113)', () => {
  it('requires STARTTLS in production unless the connection is TLS from the start', () => {
    expect(smtpTransportOptions(settings)).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
    });
    expect(smtpTransportOptions({ ...settings, SMTP_PORT: 465, SMTP_SECURE: true })).toMatchObject({
      secure: true,
      requireTLS: false,
    });
  });

  it('sends without TLS in production only to a mail server declared private', () => {
    expect(
      smtpTransportOptions({
        ...settings,
        SMTP_HOST: 'mailbox',
        SMTP_PORT: 1025,
        SMTP_ALLOW_PLAINTEXT: true,
      }),
    ).toMatchObject({ host: 'mailbox', requireTLS: false });
  });

  it('leaves TLS to the server outside production', () => {
    expect(smtpTransportOptions({ ...settings, NODE_ENV: 'development' })).toMatchObject({
      requireTLS: false,
    });
  });

  it('signs in only with both a user and a password', () => {
    expect(smtpTransportOptions({ ...settings, SMTP_USER: 'relay' })).not.toHaveProperty('auth');
    expect(
      smtpTransportOptions({ ...settings, SMTP_USER: 'relay', SMTP_PASSWORD: 'not-a-real-one' }),
    ).toMatchObject({ auth: { user: 'relay', pass: 'not-a-real-one' } });
  });
});
