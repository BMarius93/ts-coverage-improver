import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixtureRemote, FixtureRemote } from './fixture-remote';

export interface E2eContext {
  app: INestApplication;
  remote: FixtureRemote;
  dataDir: string;
  close(options?: { keepData?: boolean }): Promise<void>;
}

/**
 * Boots a Nest module with a temp database/workspace, cloning from a local bare repository instead of
 * GitHub and running the backend's Jest inside the clone. No network access needed.
 */
export async function createE2eApp(
  rootModule: unknown,
  env: Record<string, string> = {},
  configure: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
  /** Reuse the remote and database of a previous app (e.g. to simulate a restart after a crash). */
  reuse?: { remote: FixtureRemote; dataDir: string },
): Promise<E2eContext> {
  const remote = reuse?.remote ?? createFixtureRemote();
  const dataDir = reuse?.dataDir ?? mkdtempSync(join(tmpdir(), 'coverage-improver-e2e-'));
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
  try {
    const moduleRef = await configure(Test.createTestingModule({ imports: [rootModule as never] })).compile();
    const app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
    return {
      app,
      remote,
      dataDir,
      close: async (options = {}) => {
        await app.close();
        if (options.keepData) return;
        remote.cleanup();
        rmSync(dataDir, { recursive: true, force: true });
      },
    };
  } finally {
    process.env = previous;
  }
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
