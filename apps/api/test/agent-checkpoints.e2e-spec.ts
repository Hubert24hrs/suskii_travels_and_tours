import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Pool } from 'pg';

import { AgentThreads } from '../src/privacy/agent-threads';
import { RETENTION_DAYS } from '../src/privacy/retention.service';
import { UNMANAGED_TABLES } from '../src/privacy/unmanaged-tables';

import { bearer, PASSWORD, signUp } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

/**
 * ADR-103: the agent service's checkpoints live in tables of a schema of their own that a
 * checked-in migration creates. The library's own set-up must find nothing to do there, every
 * table has a deletion and retention rule, and a thread's rows go with its conversation.
 */
describe('agent checkpoints (e2e)', () => {
  let ctx: TestContext;
  let pool: Pool;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL, max: 2 });
  });
  beforeEach(async () => {
    await resetState(ctx);
  });
  afterAll(async () => {
    await pool.end();
    await ctx.close();
  });

  /** Everything about the schema's shape, as rows that compare. */
  const shape = async (): Promise<unknown> => {
    const columns = await pool.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns WHERE table_schema = 'agent'
        ORDER BY table_name, ordinal_position`,
    );
    const indexes = await pool.query(
      `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'agent'
        ORDER BY tablename, indexname`,
    );
    const constraints = await pool.query(
      `SELECT c.conrelid::regclass::text AS on_table, c.conname, pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'agent' ORDER BY 1, 2`,
    );
    const applied = await pool.query('SELECT v FROM "agent"."checkpoint_migrations" ORDER BY v');
    return {
      columns: columns.rows,
      indexes: indexes.rows,
      constraints: constraints.rows,
      applied: applied.rows,
    };
  };

  const thread = async (conversationId: string): Promise<void> => {
    await pool.query(
      `INSERT INTO "agent"."checkpoints" (thread_id, checkpoint_id, checkpoint) VALUES ($1, 'c1', '{}')`,
      [conversationId],
    );
    await pool.query(
      `INSERT INTO "agent"."checkpoint_blobs" (thread_id, channel, version, type, blob) VALUES ($1, 'history', '1', 'json', '\\x7b7d')`,
      [conversationId],
    );
    await pool.query(
      `INSERT INTO "agent"."checkpoint_writes" (thread_id, checkpoint_id, task_id, idx, channel, type, blob) VALUES ($1, 'c1', 't1', 0, 'turn', 'json', '\\x7b7d')`,
      [conversationId],
    );
  };
  const rowsOf = async (conversationId: string): Promise<number[]> =>
    Promise.all(
      ['checkpoints', 'checkpoint_blobs', 'checkpoint_writes'].map(async (table) => {
        const result = await pool.query<{ count: string }>(
          `SELECT count(*) FROM "agent"."${table}" WHERE thread_id = $1`,
          [conversationId],
        );
        return Number(result.rows[0]?.count ?? 0);
      }),
    );
  const conversation = async (userId: string, lastMessageAt = new Date()): Promise<string> => {
    const row = await ctx.prisma.agentConversation.create({
      data: {
        reference: `A-${Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0')}`,
        userId,
        audience: 'customer',
        channel: 'web',
        locale: 'en-NG',
        currency: 'NGN',
        lastMessageAt,
      },
    });
    return row.id;
  };

  it('gives every table of the agent schema a deletion and retention rule', async () => {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'agent' ORDER BY 1`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      UNMANAGED_TABLES.map((table) => table.table).sort(),
    );
    for (const table of UNMANAGED_TABLES) {
      expect(table.note.length).toBeGreaterThan(20);
      // Anything with a thread column holds what was said: it is deleted and it is purged.
      expect([table.table, table.deletion, table.retention.kind]).toEqual(
        table.threadColumn ? [table.table, 'delete', 'rule'] : [table.table, 'none', 'reference'],
      );
    }
  });

  it("finds nothing for the library's own set-up to do", async () => {
    const before = await shape();
    expect((before as { applied: unknown[] }).applied.length).toBeGreaterThan(0);
    // The pinned library, against the database as our migration left it.
    await new PostgresSaver(pool, undefined, { schema: 'agent' }).setup();
    // A difference means the library's tables changed: write the migration before upgrading.
    expect(await shape()).toEqual(before);
  });

  it('deletes a thread with its conversation, and only that thread', async () => {
    const owner = await signUp(ctx, 'threads-owner@example.com');
    const other = await signUp(ctx, 'threads-other@example.com');
    const mine = await conversation(owner.userId);
    const theirs = await conversation(other.userId);
    await thread(mine);
    await thread(theirs);

    expect(await ctx.app.get(AgentThreads).delete([mine])).toBe(3);
    expect(await rowsOf(mine)).toEqual([0, 0, 0]);
    expect(await rowsOf(theirs)).toEqual([1, 1, 1]);
    expect(await ctx.app.get(AgentThreads).delete([])).toBe(0);
  });

  it("deletes a person's threads when their account is deleted", async () => {
    const owner = await signUp(ctx, 'threads-leaving@example.com');
    const other = await signUp(ctx, 'threads-staying@example.com');
    const mine = await conversation(owner.userId);
    const theirs = await conversation(other.userId);
    await thread(mine);
    await thread(theirs);

    await ctx
      .http()
      .post('/v1/me/deletion')
      .set(bearer(owner.accessToken))
      .send({ password: PASSWORD, confirm: 'DELETE' })
      .expect(200);
    expect(await ctx.prisma.agentConversation.count({ where: { id: mine } })).toBe(0);
    expect(await rowsOf(mine)).toEqual([0, 0, 0]);
    expect(await rowsOf(theirs)).toEqual([1, 1, 1]);
  });

  it('purges threads idle for 30 days and threads without a conversation', async () => {
    expect(RETENTION_DAYS['agent-threads']).toBe(30);
    const owner = await signUp(ctx, 'threads-idle@example.com');
    const fresh = await conversation(owner.userId, new Date(Date.now() - 29 * 86_400_000));
    const idle = await conversation(owner.userId, new Date(Date.now() - 31 * 86_400_000));
    const orphan = '0193a000-0000-7000-8000-00000000dead';
    for (const id of [fresh, idle, orphan]) await thread(id);

    const sweep = await ctx
      .http()
      .post('/v1/internal/retention/run')
      .set('Authorization', `Bearer ${E2E_INTERNAL_TOKEN}`)
      .expect(200);
    expect((sweep.body as Record<string, number>)['agent-threads']).toBe(2);
    expect(await rowsOf(fresh)).toEqual([1, 1, 1]);
    expect(await rowsOf(idle)).toEqual([0, 0, 0]);
    expect(await rowsOf(orphan)).toEqual([0, 0, 0]);
    // The conversation itself stays for its own, longer retention: only the working state went.
    expect(await ctx.prisma.agentConversation.count({ where: { id: idle } })).toBe(1);
  });
});
