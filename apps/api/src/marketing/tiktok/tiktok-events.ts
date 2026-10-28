import { z } from 'zod';

import { AdConversionsProvider, type PurchaseEvent } from '../ad-conversions.provider';

export interface TikTokEventsOptions {
  /** Business API base with its version, e.g. https://business-api.tiktok.com/open_api/v1.3. */
  baseUrl: string;
  pixelId: string;
  accessToken: string;
  /** Events Manager's test code: events show under Test Events instead of the live data. */
  testEventCode?: string | undefined;
  fetch?: typeof fetch;
}

// TikTok answers HTTP 200 with a non-zero `code` for refused events.
const answerSchema = z.looseObject({ code: z.number().int() });

/**
 * TikTok Events API (ADR-079): one web Purchase per call to `/event/track/`, deduplicated against
 * the browser tag by `event_id`. The token travels in the `Access-Token` header.
 */
export class TikTokEvents extends AdConversionsProvider {
  readonly network = 'tiktok' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TikTokEventsOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async sendPurchase(event: PurchaseEvent, signal: AbortSignal): Promise<void> {
    const { clickIds } = event;
    const response = await this.fetchImpl(`${this.options.baseUrl}/event/track/`, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: {
        'Access-Token': this.options.accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        event_source: 'web',
        event_source_id: this.options.pixelId,
        ...(this.options.testEventCode ? { test_event_code: this.options.testEventCode } : {}),
        data: [
          {
            event: 'Purchase',
            event_time: Math.floor(event.eventTime.getTime() / 1000),
            event_id: event.eventId,
            user: {
              ...(event.hashedEmail ? { email: event.hashedEmail } : {}),
              ...(event.hashedPhone ? { phone: event.hashedPhone } : {}),
              ...(clickIds.ttp ? { ttp: clickIds.ttp } : {}),
              ...(clickIds.ttclid ? { ttclid: clickIds.ttclid } : {}),
            },
            properties: {
              currency: event.currency,
              // TikTok reads the value as a JSON number; it comes from the exact decimal string.
              value: Number(event.value),
              content_type: 'product',
              contents: event.contentIds.map((id) => ({ content_id: id })),
            },
            page: { url: event.sourceUrl },
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`TikTok Events API answered HTTP ${response.status}`);
    const parsed = answerSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.code !== 0)
      throw new Error('TikTok Events API did not accept the event');
  }
}
