import { MemorySaver, type BaseCheckpointSaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pg from 'pg';

import { type AgentConfig } from './config.js';

/** The schema the checkpoint tables live in, and the only one `suskii_agent` can see (ADR-103). */
export const CHECKPOINT_SCHEMA = 'agent';

export interface Checkpointer {
  saver: BaseCheckpointSaver;
  /** True when the store answers: the tables exist and the role can read them. */
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * Where threads are kept (ADR-103). With `AGENT_DATABASE_URL`: PostgreSQL, in tables a
 * checked-in migration created. `setup()` is never called here: this role cannot create
 * anything, and a table must not appear without review. Without the setting (local, tests):
 * memory, lost at a restart.
 */
export function createCheckpointer(
  config: Pick<
    AgentConfig,
    'AGENT_DATABASE_URL' | 'AGENT_DATABASE_POOL_MAX' | 'AGENT_DATABASE_STATEMENT_TIMEOUT_MS'
  >,
): Checkpointer {
  if (!config.AGENT_DATABASE_URL) {
    return {
      saver: new MemorySaver(),
      ready: () => Promise.resolve(true),
      close: () => Promise.resolve(),
    };
  }
  const pool = new pg.Pool({
    connectionString: config.AGENT_DATABASE_URL,
    max: config.AGENT_DATABASE_POOL_MAX,
    statement_timeout: config.AGENT_DATABASE_STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5000,
    application_name: 'suskii-agent',
  });
  // An idle client that errors (a failover, a restart) must not crash the process.
  pool.on('error', () => undefined);
  return {
    saver: new PostgresSaver(pool, undefined, { schema: CHECKPOINT_SCHEMA }),
    ready: async () => {
      try {
        await pool.query(`SELECT 1 FROM "${CHECKPOINT_SCHEMA}".checkpoints LIMIT 1`);
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}
