import { NotificationService } from '../src/messaging/notification.service';

import { bearer, signUp } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * WhatsApp notifications turned off (`WHATSAPP_PROVIDER=none`, ADR-091): nothing is attempted on
 * that channel, the log says why, and the traveller's other channels still deliver.
 */
describe('notification channels turned off (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ WHATSAPP_PROVIDER: 'none' });
  });
  beforeEach(async () => {
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('skips WhatsApp as channel_off and still texts a verified phone', async () => {
    const session = await signUp(ctx, 'channels@example.com');
    await ctx.prisma.user.update({
      where: { id: session.userId },
      data: { phone: '+2348012345678', phoneVerifiedAt: new Date() },
    });
    await ctx
      .http()
      .patch('/v1/me/notification-preferences')
      .set(bearer(session.accessToken))
      .send({
        changes: [
          { category: 'price_alert', channel: 'whatsapp', enabled: true },
          { category: 'price_alert', channel: 'sms', enabled: true },
        ],
      })
      .expect(200);

    const outcome = await ctx.app.get(NotificationService).notify(session.userId, {
      category: 'price_alert',
      template: 'price-alert',
      text: 'Lagos to Abuja is now NGN 85,000.',
    });
    expect(outcome).toEqual({ sms: 'sent', whatsapp: 'skipped' });
    expect(ctx.sms.outbox.map((message) => message.template)).toEqual(['price-alert']);
    const log = await ctx.prisma.notification.findMany({
      where: { userId: session.userId },
      orderBy: { channel: 'asc' },
    });
    expect(log.map((row) => [row.channel, row.status, row.reason])).toEqual([
      ['sms', 'sent', null],
      ['whatsapp', 'skipped', 'channel_off'],
    ]);
  });
});
