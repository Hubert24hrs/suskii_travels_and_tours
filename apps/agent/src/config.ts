import { z } from 'zod';

/** Prefix of the local development tokens in .env.example; refused in production (ADR-101). */
const LOCAL_TOKEN_PREFIX = 'local-dev-only-';

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

const modelId = z.string().regex(/^[a-z0-9][a-z0-9.-]{2,63}$/);
const token = z.string().min(32);

/** Hosted tracing would send conversation text to a third party (ADR-106): never on. */
const TRACING_SWITCHES = ['LANGCHAIN_TRACING_V2', 'LANGSMITH_TRACING', 'LANGCHAIN_TRACING'];

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    AGENT_PORT: z.coerce.number().int().min(0).max(65_535).default(4200),

    /** The API, for tool calls only (`/v1/internal/agent-tools`). */
    API_INTERNAL_URL: z.url().default('http://localhost:4000'),
    /** A private network only: allows an http API URL in production (ADR-038). */
    API_INTERNAL_ALLOW_PLAINTEXT: booleanish,
    /** Presented to the tool gateway. It opens no other route of the API. */
    AGENT_TOOLS_TOKEN: token.optional(),
    /** What the API must present to start a run here. */
    AGENT_RUN_TOKEN: token.optional(),

    /**
     * Checkpoints (ADR-103): a connection as `suskii_agent`, which sees only the `agent`
     * schema. Without it, threads live in memory and are lost at a restart; production
     * requires it.
     */
    AGENT_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
    AGENT_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
    AGENT_DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60_000)
      .default(10_000),
    /** Production requires TLS to PostgreSQL unless the path is private (ADR-038). */
    AGENT_DATABASE_ALLOW_PLAINTEXT: booleanish,

    /** `mock` replays recorded turns and calls no vendor. */
    AGENT_MODEL_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
    LLM_API_KEY: z.string().min(1).optional(),
    /** A small model for routing, a stronger one for specialists, one to fall back on. */
    AGENT_MODEL_ROUTER: modelId.default('claude-haiku-5-5'),
    AGENT_MODEL_SPECIALIST: modelId.default('claude-sonnet-5-5'),
    AGENT_MODEL_FALLBACK: modelId.default('claude-haiku-5-5'),
    AGENT_MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    ALLOW_MOCK_PROVIDERS: booleanish,

    /** Runs in progress at once; more are refused, so one instance cannot be buried. */
    AGENT_MAX_CONCURRENT_RUNS: z.coerce.number().int().min(1).max(200).default(20),
    /** A tool call that takes longer than this is given up (the gateway's own limit is 25 s). */
    AGENT_TOOL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(30_000),
  })
  .superRefine((env, ctx) => {
    const require = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if (env.AGENT_MODEL_PROVIDER === 'anthropic' && !env.LLM_API_KEY) {
      require('LLM_API_KEY', 'is required when AGENT_MODEL_PROVIDER is anthropic');
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.AGENT_MODEL_PROVIDER === 'mock' && !env.ALLOW_MOCK_PROVIDERS) {
      require('AGENT_MODEL_PROVIDER', 'the mock model is not allowed in production');
    }
    for (const key of ['AGENT_TOOLS_TOKEN', 'AGENT_RUN_TOKEN'] as const) {
      const value = env[key];
      if (!value) require(key, 'is required in production');
      else if (value.startsWith(LOCAL_TOKEN_PREFIX)) {
        require(key, 'the local development token is not allowed in production');
      }
    }
    if (env.AGENT_TOOLS_TOKEN && env.AGENT_TOOLS_TOKEN === env.AGENT_RUN_TOKEN) {
      require('AGENT_RUN_TOKEN', 'must differ from AGENT_TOOLS_TOKEN');
    }
    if (!env.API_INTERNAL_ALLOW_PLAINTEXT && !env.API_INTERNAL_URL.startsWith('https://')) {
      require('API_INTERNAL_URL', 'must be https in production unless API_INTERNAL_ALLOW_PLAINTEXT=true');
    }
    if (!env.AGENT_DATABASE_URL) {
      require('AGENT_DATABASE_URL', 'is required in production: checkpoints must survive a restart');
    } else if (
      !env.AGENT_DATABASE_ALLOW_PLAINTEXT &&
      !/[?&]sslmode=(require|verify-ca|verify-full)\b/.test(env.AGENT_DATABASE_URL)
    ) {
      require('AGENT_DATABASE_URL', 'must set sslmode=require (or stricter) in production unless AGENT_DATABASE_ALLOW_PLAINTEXT=true');
    }
  });

export type AgentConfig = z.infer<typeof envSchema>;

/**
 * Parses and validates the agent service's environment. Fails fast; the error lists keys and
 * rules and never echoes a value. `KEY=` (empty) means unset, as in `.env.example`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const defined = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  for (const key of TRACING_SWITCHES) {
    if (/^(true|1)$/i.test(String(defined[key] ?? ''))) {
      throw new Error(
        `Invalid agent environment: ${key}: hosted tracing would send conversations to a third party; it is never allowed`,
      );
    }
  }
  const result = envSchema.safeParse(defined);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid agent environment: ${issues}`);
  }
  return result.data;
}
