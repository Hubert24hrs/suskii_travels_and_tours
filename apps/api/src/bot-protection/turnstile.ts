import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

export interface TurnstileCheck {
  /** Client IP after trusted-proxy resolution (optional signal for Cloudflare). */
  remoteIp?: string | undefined;
  /** The widget's `action`; a token minted for another form is rejected. */
  action: string;
}

/**
 * Cloudflare Turnstile verification behind an interface (ADR-012). Sign-up, guest checkout and
 * booking lookup reuse it in later phases.
 */
export abstract class TurnstileVerifier {
  abstract verify(token: string, check: TurnstileCheck): Promise<boolean>;
}

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const siteverifySchema = z.object({
  success: z.boolean(),
  action: z.string().optional(),
  hostname: z.string().optional(),
  'error-codes': z.array(z.string()).default([]),
});

/** Server-side siteverify with action and hostname checks. Fails closed on any error. */
export class CloudflareTurnstileVerifier extends TurnstileVerifier {
  private readonly logger = new Logger(CloudflareTurnstileVerifier.name);

  constructor(
    private readonly secret: string,
    private readonly allowedHostnames: readonly string[],
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    super();
  }

  async verify(token: string, check: TurnstileCheck): Promise<boolean> {
    try {
      const response = await this.fetchImpl(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: this.secret,
          response: token,
          ...(check.remoteIp ? { remoteip: check.remoteIp } : {}),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'turnstile siteverify failed');
        return false;
      }
      const result = siteverifySchema.parse(await response.json());
      if (!result.success) {
        this.logger.debug({ codes: result['error-codes'] }, 'turnstile token rejected');
        return false;
      }
      return (
        result.action === check.action &&
        result.hostname !== undefined &&
        this.allowedHostnames.includes(result.hostname)
      );
    } catch (error) {
      this.logger.warn({ err: (error as Error).name }, 'turnstile siteverify unavailable');
      return false;
    }
  }
}

/**
 * Development and tests only (the env schema requires a real secret in production). Accepts any
 * token except `fail`, so tests can exercise the rejection path.
 */
@Injectable()
export class MockTurnstileVerifier extends TurnstileVerifier {
  private readonly logger = new Logger(MockTurnstileVerifier.name);

  verify(token: string, check: TurnstileCheck): Promise<boolean> {
    this.logger.debug({ action: check.action }, 'turnstile check skipped by mock verifier');
    return Promise.resolve(token !== 'fail');
  }
}
