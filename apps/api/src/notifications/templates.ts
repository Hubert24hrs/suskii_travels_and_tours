import { BRAND } from '@suskii/shared';

import type { EmailMessage } from './email';

// Plain, English-only copy until the i18n package lands (phase 4). Links carry tokens in the URL
// fragment, so they never reach server logs or Referer headers.

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function layout(heading: string, paragraphs: string[], action?: { label: string; url: string }) {
  const body = paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join('');
  const button = action
    ? `<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></p>`
    : '';
  return `<!doctype html><html><body><h1>${escapeHtml(heading)}</h1>${body}${button}<p>${escapeHtml(BRAND.name)}</p></body></html>`;
}

type Template = Omit<EmailMessage, 'to'>;

export function verifyEmailTemplate(url: string): Template {
  const intro = `Confirm your email address to finish setting up your ${BRAND.name} account.`;
  const expiry = 'This link expires in 24 hours. If you did not sign up, ignore this email.';
  return {
    template: 'verify-email',
    subject: `Confirm your email for ${BRAND.name}`,
    text: `${intro}\n\n${url}\n\n${expiry}`,
    html: layout('Confirm your email', [intro, expiry], { label: 'Confirm email', url }),
  };
}

export function accountExistsTemplate(signInUrl: string): Template {
  const intro = `Someone tried to create a ${BRAND.name} account with this email address, which already has an account.`;
  const next =
    'If it was you, sign in or reset your password. Otherwise you can ignore this email.';
  return {
    template: 'account-exists',
    subject: `You already have a ${BRAND.name} account`,
    text: `${intro}\n\n${next}\n\n${signInUrl}`,
    html: layout('You already have an account', [intro, next], {
      label: 'Sign in',
      url: signInUrl,
    }),
  };
}

export function passwordResetTemplate(url: string): Template {
  const intro = 'We received a request to reset your password.';
  const expiry =
    'This link expires in 30 minutes and signs you out everywhere. If you did not ask for it, ignore this email.';
  return {
    template: 'password-reset',
    subject: `Reset your ${BRAND.name} password`,
    text: `${intro}\n\n${url}\n\n${expiry}`,
    html: layout('Reset your password', [intro, expiry], { label: 'Reset password', url }),
  };
}

export function newsletterConfirmTemplate(confirmUrl: string, unsubscribeUrl: string): Template {
  const intro = `Confirm that you want deal alerts from ${BRAND.name}: fresh fares and offers, a few times a month.`;
  const expiry =
    'This link expires in 48 hours. If you did not sign up, ignore this email and nothing will be sent.';
  const leave = `Changed your mind later? Unsubscribe any time: ${unsubscribeUrl}`;
  return {
    template: 'newsletter-confirm',
    subject: `Confirm your deal alerts from ${BRAND.name}`,
    text: `${intro}\n\n${confirmUrl}\n\n${expiry}\n\n${leave}`,
    html: layout('Confirm your deal alerts', [intro, expiry, leave], {
      label: 'Confirm subscription',
      url: confirmUrl,
    }),
  };
}

export function otpSmsBody(code: string): string {
  return `${code} is your ${BRAND.name} verification code. It expires in 5 minutes. Never share it.`;
}
