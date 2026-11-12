import { Injectable } from '@nestjs/common';

import { HmacService } from '../crypto/hmac.service';
import { randomToken } from '../crypto/random';

/** Emailed links open a guest's conversation for this long. */
export const SUPPORT_LINK_TTL_MS = 30 * 86_400_000;

/**
 * Guest access to support conversations (ADR-083). A guest holds the access token returned when
 * the conversation started (stored only as an HMAC); reply emails carry a signed link token
 * instead (`{id}.{expires}.{signature}`), because the access token itself is never kept.
 */
@Injectable()
export class SupportAccess {
  constructor(private readonly hmac: HmacService) {}

  /** A new access token and the digest stored with the conversation. */
  issue(): { token: string; hash: string } {
    const token = randomToken();
    return { token, hash: this.hmac.digest('support-access', token) };
  }

  /** A token for reply emails that opens only this conversation until it expires. */
  link(conversationId: string, now = Date.now()): string {
    const expires = now + SUPPORT_LINK_TTL_MS;
    return `${conversationId}.${expires}.${this.hmac.digest('support-link', `${conversationId}.${expires}`)}`;
  }

  /** Whether `token` opens the conversation: its access token, or a live link for it. */
  opens(
    conversation: { id: string; accessTokenHash: string | null },
    token: string,
    now = Date.now(),
  ): boolean {
    if (
      conversation.accessTokenHash &&
      this.hmac.verify('support-access', token, conversation.accessTokenHash)
    ) {
      return true;
    }
    const [id, expiresText, signature] = token.split('.');
    const expires = Number(expiresText);
    return (
      id === conversation.id &&
      signature !== undefined &&
      Number.isSafeInteger(expires) &&
      expires > now &&
      this.hmac.verify('support-link', `${id}.${expires}`, signature)
    );
  }
}
