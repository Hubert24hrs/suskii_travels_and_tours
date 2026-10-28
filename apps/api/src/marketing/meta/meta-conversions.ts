import { z } from 'zod';

import { AdConversionsProvider, type PurchaseEvent } from '../ad-conversions.provider';

export interface MetaConversionsOptions {
  /** Graph API base with its version, e.g. https://graph.facebook.com/v24.0. */
  baseUrl: string;
  pixelId: string;
  accessToken: string;
  /** Events Manager's Test Events code: events go to the test tab, not the live data set. */
  testEventCode?: string | undefined;
  fetch?: typeof fetch;
}

const acceptedSchema = z.looseObject({ events_received: z.number().int() });

/**
 * Meta Conversions API (ADR-079): one Purchase per call to `/{pixel}/events`, deduplicated against
 * the browser tag by `event_id`. The token travels in the body, never in the URL, so it stays out
 * of proxy and access logs.
 */
export class MetaConversions extends AdConversionsProvider {
  readonly network = 'meta' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: MetaConversionsOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async sendPurchase(event: PurchaseEvent, signal: AbortSignal): Promise<void> {
    const { clickIds } = event;
    const response = await this.fetchImpl(
      `${this.options.baseUrl}/${encodeURIComponent(this.options.pixelId)}/events`,
      {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          data: [
            {
              event_name: 'Purchase',
              event_time: Math.floor(event.eventTime.getTime() / 1000),
              event_id: event.eventId,
              action_source: 'website',
              event_source_url: event.sourceUrl,
              user_data: {
                ...(event.hashedEmail ? { em: [event.hashedEmail] } : {}),
                ...(event.hashedPhone ? { ph: [event.hashedPhone] } : {}),
                ...(clickIds.fbp ? { fbp: clickIds.fbp } : {}),
                ...(clickIds.fbc ? { fbc: clickIds.fbc } : {}),
              },
              custom_data: {
                currency: event.currency,
                // Meta reads the value as a JSON number; it comes from the exact decimal string.
                value: Number(event.value),
                content_type: 'product',
                content_ids: event.contentIds,
              },
            },
          ],
          access_token: this.options.accessToken,
          ...(this.options.testEventCode ? { test_event_code: this.options.testEventCode } : {}),
        }),
      },
    );
    // The status only: Meta's error bodies can echo request values.
    if (!response.ok) throw new Error(`Meta Conversions API answered HTTP ${response.status}`);
    const parsed = acceptedSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.events_received < 1)
      throw new Error('Meta Conversions API did not accept the event');
  }
}
