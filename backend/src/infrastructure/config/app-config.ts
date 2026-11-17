import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
/** `.env` files often carry trailing comments (`X=1   # note`); strip them before validation. */
const stripComment = (value: string | undefined): string | undefined => value?.replace(/\s+#.*$/, '').trim();

const schema = z.object({
  PORT: int(1, 65535).default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_PATH: z.string().min(1).default('./data/app.db'),
  WORKSPACE_DIR: z.string().min(1).default('./workspaces'),
  KEEP_FAILED_WORKSPACES: bool.default(true),

  COVERAGE_THRESHOLD: z.coerce.number().gt(0).max(100).default(80),
  COVERAGE_SOURCE_GLOB: z.string().min(1).default('src/**/*.ts'),
  /** Advanced/testing: how Jest is invoked inside a cloned repository. */
  JEST_COMMAND: z.string().min(1).default('npx --no-install jest'),

  GITHUB_TOKEN: z.string().optional(),
  /** Advanced/testing: clone from somewhere other than GitHub (e.g. file:///tmp/remotes). */
  GIT_CLONE_BASE_URL: z.string().default('https://github.com'),
  GIT_AUTHOR_NAME: z.string().min(1).default('TS Coverage Improver'),
  GIT_AUTHOR_EMAIL: z.string().min(3).default('coverage-improver@users.noreply.github.com'),

  RUN_WORKER: bool.default(true),
  WORKER_CONCURRENCY: int(1, 32).default(3),
  WORKER_POLL_INTERVAL_MS: int(100, 600_000).default(2000),
  JOB_LEASE_SECONDS: int(5, 3600).default(60),
  JOB_MAX_ATTEMPTS: int(1, 10).default(2),
  PROCESS_TIMEOUT_MS: int(1000, 3_600_000).default(600_000),

  AI_CLI_PATH: z.string().min(1).default('claude'),
  AI_MODE: z.enum(['single', 'plan-and-write']).default('plan-and-write'),
  AI_PLANNER_MODEL: z.string().min(1).default('opus'),
  AI_WRITER_MODEL: z.string().min(1).default('sonnet'),
  AI_PLANNER_MAX_TURNS: int(1, 200).default(10),
  AI_WRITER_MAX_TURNS: int(1, 200).default(30),
  AI_MAX_BUDGET_USD: z.coerce.number().positive().default(3),
  AI_TIMEOUT_MS: int(1000, 3_600_000).default(600_000),
  AI_MAX_FIX_ATTEMPTS: int(0, 10).default(2),
  /** Runs of the related tests during verification; all must pass with identical coverage. */
  VERIFY_RUNS: int(1, 5).default(2),
});

export type RawConfig = z.infer<typeof schema>;

export interface AppConfig extends RawConfig {
  /** Absolute paths, resolved against the working directory. */
  databasePath: string;
  workspaceDir: string;
  /** Scans running longer than this are considered dead. */
  maxScanDurationMs: number;
}

export class ConfigError extends Error {}

export const APP_CONFIG = Symbol('AppConfig');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const input: Record<string, string> = {};
  for (const [key, raw] of Object.entries(env)) {
    const value = stripComment(raw);
    if (value !== undefined && value !== '') input[key] = value;
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid configuration: ${problems}`);
  }
  const config = parsed.data;
  const absolute = (path: string) => (path === ':memory:' || isAbsolute(path) ? path : resolve(path));
  return {
    ...config,
    databasePath: absolute(config.DATABASE_PATH),
    workspaceDir: absolute(config.WORKSPACE_DIR),
    maxScanDurationMs: config.PROCESS_TIMEOUT_MS * 3,
  };
}
