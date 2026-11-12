import { Injectable } from '@nestjs/common';

import { HmacService } from '../crypto/hmac.service';
import { randomToken } from '../crypto/random';

/**
 * Signed, session-bound CSRF tokens (OWASP "signed double-submit" variant):
 * `<nonce>.<HMAC(sessionId.nonce)>`. A token is only valid for the session it was issued to, so
 * a token planted by an attacker (e.g. via a sibling subdomain cookie) or taken from their own
 * session is useless. The token is delivered in a readable cookie and in the auth response body,
 * and must come back in the X-CSRF-Token header.
 */
@Injectable()
export class CsrfService {
  constructor(private readonly hmac: HmacService) {}

  issue(sessionId: string): string {
    const nonce = randomToken(16);
    return `${nonce}.${this.hmac.digest('csrf', `${sessionId}.${nonce}`)}`;
  }

  verify(sessionId: string, token: string | undefined): boolean {
    if (!token || token.length > 128) return false;
    const [nonce, signature, extra] = token.split('.');
    if (!nonce || !signature || extra !== undefined) return false;
    return this.hmac.verify('csrf', `${sessionId}.${nonce}`, signature);
  }
}
