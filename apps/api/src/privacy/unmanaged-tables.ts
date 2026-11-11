import type { RetentionRule } from './retention.service';

/**
 * Tables Prisma does not manage (ADR-103). `DATA_REGISTRY` decides export, deletion and
 * retention for every Prisma model; a table outside Prisma gets the same decisions here, and
 * `agent-checkpoints.e2e-spec.ts` lists the schema's tables and fails on one that is missing.
 */
export interface UnmanagedTable {
  schema: string;
  table: string;
  /** What deleting an account or a conversation does to its rows. */
  deletion: 'delete' | 'none';
  retention: { kind: 'rule'; rule: RetentionRule } | { kind: 'reference' };
  /** The column that ties a row to a conversation, when it holds personal data. */
  threadColumn: string | null;
  note: string;
}

const checkpoints = (table: string, note: string): UnmanagedTable => ({
  schema: 'agent',
  table,
  deletion: 'delete',
  retention: { kind: 'rule', rule: 'agent-threads' },
  threadColumn: 'thread_id',
  note,
});

export const UNMANAGED_TABLES: readonly UnmanagedTable[] = [
  checkpoints(
    'checkpoints',
    "A thread's state between runs of the assistant: the conversation as the model saw it (scrubbed words, answers, tool results as facts). Not exported: the same words are in agent_messages.",
  ),
  checkpoints(
    'checkpoint_blobs',
    'Channel values of checkpoints, stored once per version. Same content and rules as checkpoints.',
  ),
  checkpoints(
    'checkpoint_writes',
    'Writes of a step in progress, so an interrupted run resumes. Same content and rules as checkpoints.',
  ),
  {
    schema: 'agent',
    table: 'checkpoint_migrations',
    deletion: 'none',
    retention: { kind: 'reference' },
    threadColumn: null,
    note: "Which of the checkpoint library's migrations are applied. No personal data.",
  },
];

/** The tables that hold a thread's rows, in the order they are deleted. */
export const THREAD_TABLES = UNMANAGED_TABLES.filter((table) => table.threadColumn !== null).map(
  (table) => `"${table.schema}"."${table.table}"`,
);
