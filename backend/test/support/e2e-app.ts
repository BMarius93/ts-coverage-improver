import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixtureRemote, FixtureRemote } from './fixture-remote';

export interface E2eContext {
  app: INestApplication;
  remote: FixtureRemote;
  dataDir: string;
  close(): Promise<void>;
}

/**
 * Boots a Nest module with a temp database/workspace, cloning from a local bare repository instead of
 * GitHub and running the backend's Jest inside the clone. No network access needed.
 */
export async function createE2eApp(
  rootModule: unknown,
  env: Record<string, string> = {},
  configure: (
    builder: ReturnType<typeof Test.createTestingModule>,
  ) => ReturnType<typeof Test.createTestingModule> = (b) => b,
): Promise<E2eContext> {
  const remote = createFixtureRemote();
  const dataDir = mkdtempSync(join(tmpdir(), 'coverage-improver-e2e-'));
  const previous = { ...process.env };
  Object.assign(process.env, {
    DATABASE_PATH: join(dataDir, 'app.db'),
    WORKSPACE_DIR: join(dataDir, 'workspaces'),
    GIT_CLONE_BASE_URL: remote.cloneBaseUrl,
    JEST_COMMAND: remote.jestCommand,
    GITHUB_TOKEN: 'ghp_e2e_dummy',
    RUN_WORKER: 'false',
    PROCESS_TIMEOUT_MS: '60000',
    ...env,
  });
  const moduleRef = await configure(Test.createTestingModule({ imports: [rootModule as never] })).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  await app.init();
  process.env = previous;
  return {
    app,
    remote,
    dataDir,
    close: async () => {
      await app.close();
      remote.cleanup();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function waitFor<T>(
  probe: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting; last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
