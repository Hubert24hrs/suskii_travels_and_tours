import { KNOWLEDGE_MAX_BYTES, type AgentScope } from '@suskii/shared';

import { AgentGrants, type AgentGrant } from '../src/agent/agent-grants';
import { EICAR, MockAntivirusScanner } from '../src/visa/antivirus';

import { staffSession } from './helpers/cars';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * The knowledge base (ADR-105): documents staff upload for the assistant to answer from. A
 * document is text, virus-scanned, split into passages and found with PostgreSQL full-text
 * search; a traveller's assistant reads only what was written for travellers; an archived
 * document is never read; every change is audited.
 */
const TOOLS_TOKEN = 'e2e-agent-tools-token-0123456789abcdefghijkl';
const RUN_TOKEN = 'e2e-agent-run-token-0123456789abcdefghijklmn';

interface Doc {
  id: string;
  title: string;
  audience: string;
  language: string;
  mediaType: string;
  sizeBytes: number;
  passages: number;
  archivedAt: string | null;
}
interface Passage {
  passageId: string;
  document: string;
  section: string | null;
  text: string;
  documentLastChanged: string;
}
interface Found {
  found: number;
  passages: Passage[];
  cards: { kind: string; title: string; lines: string[] }[];
}

const REFUNDS = [
  '# Refund policy',
  '',
  'How Suskii refunds travellers.',
  '',
  '## Flights cancelled by the airline',
  '',
  'When the airline cancels a flight, everything the traveller paid is refunded.',
  'Refunds reach the original payment method within 10 working days.',
  '',
  '## Hotels',
  '',
  "A hotel stay is refunded under the rate's own cancellation terms.",
].join('\n');

const DESK = [
  '# Refund desk procedure',
  '',
  'Staff only. A refund above the approval threshold needs a second approver.',
  'Escalate a chargeback to finance the same day.',
].join('\n');

const BAGAGES = [
  '# Bagages',
  '',
  'Un bagage en soute de 23 kg est inclus sur les vols internationaux.',
].join('\n');

const GUEST_SCOPES: AgentScope[] = ['catalog', 'search', 'quotes', 'support'];

describe('knowledge base (e2e)', () => {
  let ctx: TestContext;
  let grants: AgentGrants;
  let scanner: MockAntivirusScanner;
  let root: { userId: string; headers: Record<string, string> };
  let ops: { userId: string; headers: Record<string, string> };
  let content: { userId: string; headers: Record<string, string> };

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AGENT_ENABLED: true,
      AGENT_SERVICE: 'mock',
      AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
      AGENT_RUN_TOKEN: RUN_TOKEN,
    });
    grants = ctx.app.get(AgentGrants);
    scanner = ctx.app.get(MockAntivirusScanner);
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    scanner.failNext = 0;
    root = await staffSession(ctx, 'knowledge-root@suskii.test', ['super_admin']);
    ops = await staffSession(ctx, 'knowledge-ops@suskii.test', ['operations']);
    content = await staffSession(ctx, 'knowledge-content@suskii.test', ['content_manager']);
  });
  afterAll(async () => {
    await ctx.background.drain();
    await ctx.close();
  });

  const upload = (
    text: string | Buffer,
    query: Record<string, string>,
    headers = root.headers,
    type = 'text/markdown',
  ) =>
    ctx
      .http()
      .post('/v1/admin/ai/knowledge')
      .query(query)
      .set(headers)
      .set('content-type', type)
      .send(typeof text === 'string' ? Buffer.from(text, 'utf8') : text);
  const add = async (
    text: string,
    query: Record<string, string>,
    type = 'text/markdown',
  ): Promise<Doc> => {
    const response = await upload(text, query, root.headers, type);
    expect(response.status).toBe(201);
    return response.body as Doc;
  };
  const customerDoc = () =>
    add(REFUNDS, { title: 'Refund policy', audience: 'customer', language: 'en' });
  const staffDoc = () =>
    add(DESK, { title: 'Refund desk procedure', audience: 'staff', language: 'en' });

  const grantFor = async (over: Partial<AgentGrant> = {}): Promise<string> => {
    const run = await ctx.prisma.agentRun.create({
      data: {
        audience: over.audience ?? 'customer',
        channel: over.channel ?? 'web',
        agent: 'concierge',
        trigger: 'message',
        status: 'running',
      },
    });
    return grants.issue({
      runId: run.id,
      conversationId: null,
      userId: null,
      roles: [],
      audience: 'customer',
      channel: 'web',
      scopes: GUEST_SCOPES,
      locale: 'en-NG',
      currency: 'NGN',
      country: 'NG',
      ...over,
    });
  };
  const ask = async (query: string, agent: string, grant: string): Promise<Found> => {
    const response = await ctx
      .http()
      .post('/v1/internal/agent-tools/knowledge.search')
      .set('authorization', `Bearer ${TOOLS_TOKEN}`)
      .send({ grant, agent, arguments: { query } });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    return (response.body as { result: Found }).result;
  };

  it('lets staff with the assistant rights read it, and only its managers change it', async () => {
    const document = await customerDoc();
    // Operations reads; a content manager holds no assistant permission at all.
    expect((await ctx.http().get('/v1/admin/ai/knowledge').set(ops.headers)).status).toBe(200);
    expect((await ctx.http().get('/v1/admin/ai/knowledge').set(content.headers)).status).toBe(403);
    expect((await ctx.http().get('/v1/admin/ai/knowledge')).status).toBe(401);
    const query = { title: 'Another policy', audience: 'customer', language: 'en' };
    expect((await upload('# Other\n\nText.', query, ops.headers)).status).toBe(403);
    for (const path of ['archive', 'restore']) {
      expect(
        (
          await ctx
            .http()
            .post(`/v1/admin/ai/knowledge/${document.id}/${path}`)
            .set(ops.headers)
            .send({})
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await ctx
          .http()
          .patch(`/v1/admin/ai/knowledge/${document.id}`)
          .set(ops.headers)
          .send({ title: 'Renamed by someone without the right' })
      ).status,
    ).toBe(403);
    expect(await ctx.prisma.knowledgeDocument.count()).toBe(1);
  });

  it('splits a document into passages at its headings and shows them as the assistant reads them', async () => {
    const document = await customerDoc();
    expect(document).toMatchObject({
      title: 'Refund policy',
      audience: 'customer',
      language: 'en',
      mediaType: 'text/markdown',
      sizeBytes: Buffer.byteLength(REFUNDS),
      passages: 3,
      archivedAt: null,
    });
    const list = (await ctx.http().get('/v1/admin/ai/knowledge').set(ops.headers)).body as {
      items: Doc[];
      inUse: number;
      limit: number;
      maxBytes: number;
    };
    expect(list).toMatchObject({ inUse: 1, limit: 200, maxBytes: KNOWLEDGE_MAX_BYTES });
    expect(list.items.map((item) => item.id)).toEqual([document.id]);

    const detail = (await ctx.http().get(`/v1/admin/ai/knowledge/${document.id}`).set(ops.headers))
      .body as { document: Doc; passages: { position: number; heading: string; body: string }[] };
    expect(detail.passages.map((passage) => [passage.position, passage.heading])).toEqual([
      [0, 'Refund policy'],
      [1, 'Refund policy \u203A Flights cancelled by the airline'],
      [2, 'Refund policy \u203A Hotels'],
    ]);
    expect(detail.passages[1]?.body).toContain('within 10 working days');

    // The file comes back as it was uploaded, as an attachment a browser will not render.
    const file = await ctx
      .http()
      .get(`/v1/admin/ai/knowledge/${document.id}/content`)
      .set(ops.headers)
      .buffer(true)
      .parse((response, done) => {
        const parts: Buffer[] = [];
        response.on('data', (part: Buffer) => parts.push(part));
        response.on('end', () => {
          done(null, Buffer.concat(parts));
        });
      });
    expect(file.status).toBe(200);
    expect((file.body as Buffer).toString('utf8')).toBe(REFUNDS);
    expect(file.headers['content-disposition']).toContain('attachment');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(
      (
        await ctx
          .http()
          .get('/v1/admin/ai/knowledge/00000000-0000-7000-8000-000000000000')
          .set(root.headers)
      ).status,
    ).toBe(404);
  });

  it('refuses what is not text, what fails the virus check, what is too large or empty, and a copy', async () => {
    const query = { title: 'A document', audience: 'customer', language: 'en' };
    // The declared type must be text, and so must the bytes, whatever was declared.
    expect((await upload('# Title\n\nText.', query, root.headers, 'application/pdf')).status).toBe(
      415,
    );
    const binary = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02, 0xff, 0xfe]);
    expect((await upload(binary, query)).body).toMatchObject({ status: 415 });
    expect((await upload(Buffer.from([0xc3, 0x28, 0x61]), query)).status).toBe(415);

    const infected = await upload(`# Notes\n\n${EICAR}\n`, query);
    expect(infected.status).toBe(422);
    expect(infected.body).toMatchObject({ type: expect.stringContaining('document-infected') });
    // A scanner that cannot answer is never read as clean.
    scanner.failNext = 1;
    const unscanned = await upload('# Notes\n\nText.', query);
    expect(unscanned.status).toBe(503);
    expect(unscanned.body).toMatchObject({ type: expect.stringContaining('scan-unavailable') });

    const large = await upload('a'.repeat(KNOWLEDGE_MAX_BYTES + 1), query);
    expect(large.status).toBe(413);
    const empty = await upload('\n\n# Only a heading\n\n', query);
    expect(empty.status).toBe(422);
    expect(empty.body).toMatchObject({ type: expect.stringContaining('knowledge-empty') });
    expect((await upload('# T\n\nText.', { ...query, title: 'ab' })).status).toBe(400);
    expect((await upload('# T\n\nText.', { ...query, audience: 'everyone' })).status).toBe(400);
    expect((await upload('# T\n\nText.', { ...query, language: 'de' })).status).toBe(400);
    expect(await ctx.prisma.knowledgeDocument.count()).toBe(0);
    expect(await ctx.prisma.knowledgeChunk.count()).toBe(0);

    await customerDoc();
    const copy = await upload(REFUNDS, { title: 'Again', audience: 'customer', language: 'en' });
    expect(copy.status).toBe(409);
    expect(copy.body).toMatchObject({ type: expect.stringContaining('knowledge-duplicate') });
    // The same text for staff is another document.
    expect(
      (await upload(REFUNDS, { title: 'For staff', audience: 'staff', language: 'en' })).status,
    ).toBe(201);
    expect(await ctx.prisma.knowledgeDocument.count()).toBe(2);
  });

  it("answers a traveller's assistant from travellers' documents only, with the source named", async () => {
    await customerDoc();
    await staffDoc();
    const guest = await grantFor();
    const found = await ask('What happens when the airline cancels my flight?', 'concierge', guest);
    expect(found.found).toBeGreaterThan(0);
    expect(found.passages[0]).toMatchObject({
      document: 'Refund policy',
      section: 'Refund policy \u203A Flights cancelled by the airline',
      documentLastChanged: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown,
    });
    expect(found.passages[0]?.text).toContain('everything the traveller paid is refunded');
    // The card names the document once, however many of its passages were read.
    expect(found.cards).toEqual([
      expect.objectContaining({ kind: 'source', title: 'Refund policy' }),
    ]);
    // Words are matched by their stem: "refunded" finds "refund", "hotels" finds "hotel".
    const stemmed = await ask('hotel refunding', 'support', guest);
    expect(stemmed.passages.map((passage) => passage.section)).toContain(
      'Refund policy \u203A Hotels',
    );

    // Nothing written for staff reaches a traveller's assistant, however it is asked.
    for (const question of ['refund desk procedure', 'second approver', 'chargeback']) {
      const answer = await ask(question, 'concierge', guest);
      expect(answer.passages.every((passage) => passage.document === 'Refund policy')).toBe(true);
    }
    expect((await ask('chargeback escalation', 'concierge', guest)).found).toBe(0);
    // A question with nothing to look up finds nothing, and says so with a count.
    expect(await ask('the of and', 'concierge', guest)).toEqual({
      found: 0,
      passages: [],
      cards: [],
    });

    // A staff agent in the console reads both.
    const staff = await grantFor({
      userId: root.userId,
      roles: ['super_admin'],
      audience: 'staff',
      channel: 'console',
      scopes: ['catalog', 'search', 'reports'],
    });
    const desk = await ask('chargeback escalation', 'executive', staff);
    expect(desk.passages[0]).toMatchObject({ document: 'Refund desk procedure' });
    const both = await ask('refund', 'executive', staff);
    expect(new Set(both.passages.map((passage) => passage.document))).toEqual(
      new Set(['Refund policy', 'Refund desk procedure']),
    );
  });

  it("searches in the traveller's language first and falls back to English", async () => {
    await customerDoc();
    await add(BAGAGES, { title: 'Bagages', audience: 'customer', language: 'fr' }, 'text/plain');
    const french = await grantFor({ locale: 'fr' });
    const bags = await ask('bagage inclus en soute', 'flights', french);
    expect(bags.passages[0]).toMatchObject({ document: 'Bagages' });
    // Nothing in French about refunds: the English document answers.
    const refunds = await ask('airline cancels flight refund', 'flights', french);
    expect(refunds.passages[0]).toMatchObject({ document: 'Refund policy' });
    // An English conversation is never answered from the French document.
    const english = await grantFor({ locale: 'en-GB' });
    expect((await ask('bagage en soute', 'flights', english)).found).toBe(0);
  });

  it('stops answering from an archived document at once, and puts it back when restored', async () => {
    const document = await customerDoc();
    const guest = await grantFor();
    const archive = await ctx
      .http()
      .post(`/v1/admin/ai/knowledge/${document.id}/archive`)
      .set(root.headers)
      .send({});
    expect(archive.status).toBe(200);
    expect((archive.body as Doc).archivedAt).toEqual(expect.any(String));
    expect((await ask('airline cancels flight', 'concierge', guest)).found).toBe(0);
    // Out of the list in use, in the archived one; its passages are kept.
    const lists = await Promise.all(
      ['false', 'true'].map(
        async (archived) =>
          (
            (await ctx.http().get(`/v1/admin/ai/knowledge?archived=${archived}`).set(root.headers))
              .body as { items: Doc[]; inUse: number }
          ).items.length,
      ),
    );
    expect(lists).toEqual([0, 1]);
    expect(await ctx.prisma.knowledgeChunk.count()).toBe(3);
    expect(
      (
        await ctx
          .http()
          .post(`/v1/admin/ai/knowledge/${document.id}/archive`)
          .set(root.headers)
          .send({})
      ).status,
    ).toBe(409);

    // The same file can be added again while the old one is archived; then the old one cannot
    // come back beside it.
    const again = await customerDoc();
    const restore = () =>
      ctx.http().post(`/v1/admin/ai/knowledge/${document.id}/restore`).set(root.headers).send({});
    const clash = await restore();
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ type: expect.stringContaining('knowledge-duplicate') });
    await ctx
      .http()
      .post(`/v1/admin/ai/knowledge/${again.id}/archive`)
      .set(root.headers)
      .send({})
      .expect(200);
    expect((await restore()).status).toBe(200);
    expect((await ask('airline cancels flight', 'concierge', guest)).found).toBeGreaterThan(0);
  });

  it('changes a title or an audience, shows staff what would be found, and audits every change', async () => {
    const document = await customerDoc();
    const guest = await grantFor();
    const patch = (body: Record<string, unknown>) =>
      ctx.http().patch(`/v1/admin/ai/knowledge/${document.id}`).set(root.headers).send(body);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ language: 'fr' })).status).toBe(400);
    const renamed = await patch({ title: 'Refunds and cancellations' });
    expect(renamed.status).toBe(200);
    expect((renamed.body as Doc).title).toBe('Refunds and cancellations');
    expect((await ask('airline cancels flight', 'concierge', guest)).passages[0]?.document).toBe(
      'Refunds and cancellations',
    );

    // What the assistant would find, for staff to check before relying on it.
    const preview = (audience: string) =>
      ctx
        .http()
        .get('/v1/admin/ai/knowledge/search')
        .query({ q: 'airline cancels flight', audience, language: 'en' })
        .set(ops.headers);
    const before = (await preview('customer')).body as { found: number; hits: { body: string }[] };
    expect(before.found).toBeGreaterThan(0);
    expect(before.hits[0]?.body).toContain('everything the traveller paid is refunded');

    // Made a staff document, it leaves travellers' answers and stays in staff's.
    expect((await patch({ audience: 'staff' })).status).toBe(200);
    expect((await ask('airline cancels flight', 'concierge', guest)).found).toBe(0);
    expect(((await preview('customer')).body as { found: number }).found).toBe(0);
    expect(((await preview('staff')).body as { found: number }).found).toBeGreaterThan(0);
    // A change that changes nothing is not recorded.
    expect((await patch({ audience: 'staff' })).status).toBe(200);

    await ctx
      .http()
      .post(`/v1/admin/ai/knowledge/${document.id}/archive`)
      .set(root.headers)
      .send({})
      .expect(200);
    await ctx
      .http()
      .post(`/v1/admin/ai/knowledge/${document.id}/restore`)
      .set(root.headers)
      .send({})
      .expect(200);

    const audit = await ctx.prisma.auditLog.findMany({
      // The audit log is never emptied between tests: this document's rows only.
      where: { action: { startsWith: 'agent.knowledge_' }, targetId: document.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(audit.map((row) => row.action)).toEqual([
      'agent.knowledge_added',
      'agent.knowledge_changed',
      'agent.knowledge_changed',
      'agent.knowledge_archived',
      'agent.knowledge_restored',
    ]);
    for (const row of audit) {
      expect(row).toMatchObject({
        actorUserId: root.userId,
        targetType: 'knowledge_document',
        targetId: document.id,
      });
      // Ids, counts and field names: never the document's words or its title.
      expect(JSON.stringify(row.metadata)).not.toMatch(/Refund|cancel|working days/i);
    }
    expect(audit[0]?.metadata).toEqual({
      audience: 'customer',
      language: 'en',
      passages: 3,
      sizeBytes: Buffer.byteLength(REFUNDS),
    });
    // The audit log narrowed to the assistant holds these, and nothing of another area.
    const area = await ctx
      .http()
      .get('/v1/admin/audit-logs?area=assistant&limit=100')
      .set(root.headers)
      .expect(200);
    const actions = (area.body as { items: { action: string; targetId: string | null }[] }).items;
    expect(actions.length).toBeGreaterThanOrEqual(5);
    for (const row of actions) {
      expect(row.action).toMatch(/^(agent|assisted_quote|price_intel)\./);
    }
    expect(actions.filter((row) => row.targetId === document.id)).toHaveLength(5);
    expect(
      (await ctx.http().get('/v1/admin/audit-logs?area=everything').set(root.headers)).status,
    ).toBe(400);
    expect(audit[1]?.metadata).toEqual({ changes: { title: { changed: true } } });
    expect(audit[2]?.metadata).toEqual({
      changes: { audience: { from: 'customer', to: 'staff' } },
    });
  });
});
