import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Repository } from '../../../src/domain/repository/repository';
import { openDatabase } from '../../../src/infrastructure/persistence/sqlite/sqlite-database';
import { SqliteImprovementJobRepository } from '../../../src/infrastructure/persistence/sqlite/sqlite-improvement-job-repository';
import { SqliteRepositoryRepository } from '../../../src/infrastructure/persistence/sqlite/sqlite-repository-repository';
import { at, queuedJob, repoUrl, T0 } from '../../support/builders';
import { transpileSources } from '../../support/transpile';

const run = promisify(execFile);

const WORKER_SCRIPT = `
const fs = require('node:fs');
const { openDatabase } = require('./infrastructure/persistence/sqlite/sqlite-database');
const { SqliteJobQueue } = require('./infrastructure/persistence/sqlite/sqlite-job-queue');

const [dbPath, workerId, mode, startFile] = process.argv.slice(2);
const db = openDatabase(dbPath);
const queue = new SqliteJobQueue(db, { now: () => new Date() });

(async () => {
  // Start barrier: all processes begin claiming at (almost) the same moment.
  while (!fs.existsSync(startFile)) {}
  const claimed = [];
  for (;;) {
    const job = await queue.claimNext(workerId, 60000);
    if (!job) break;
    claimed.push({ id: job.id, repositoryId: job.repositoryId });
    if (mode === 'complete') {
      db.prepare("UPDATE jobs SET status = 'completed', phase = NULL, lease_until = NULL, version = version + 1 WHERE id = ?").run(job.id);
    }
  }
  db.close();
  process.stdout.write(JSON.stringify(claimed));
})().catch((error) => { process.stderr.write(String(error && error.stack)); process.exit(1); });
`;

const REPOS = ['repo-a', 'repo-b', 'repo-c'];
const FILES = ['src/one.ts', 'src/two.ts', 'src/three.ts'];
const WORKERS = 6;

describe('SqliteJobQueue under real multi-process contention', () => {
  jest.setTimeout(60_000);
  let dir: string;
  let codeDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'coverage-improver-race-'));
    codeDir = join(dir, 'code');
    transpileSources(codeDir, ['domain', 'application', 'infrastructure/persistence']);
    writeFileSync(join(codeDir, 'claim-worker.js'), WORKER_SCRIPT);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function seed(dbPath: string): Promise<void> {
    const db = openDatabase(dbPath);
    const repositories = new SqliteRepositoryRepository(db);
    const jobs = new SqliteImprovementJobRepository(db);
    let n = 0;
    for (const repositoryId of REPOS) {
      await repositories.save(
        Repository.register({
          id: repositoryId,
          url: repoUrl(`https://github.com/acme/${repositoryId}`),
          now: T0,
        }),
      );
      for (const file of FILES) {
        await jobs.save(queuedJob({ id: `${repositoryId}:${file}`, repositoryId, file, now: at(n++) }));
      }
    }
    db.close();
  }

  async function race(mode: 'hold' | 'complete'): Promise<Array<{ id: string; repositoryId: string }>> {
    const dbPath = join(dir, `${mode}.db`);
    const startFile = join(dir, `${mode}.go`);
    await seed(dbPath);
    const env = { ...process.env, NODE_PATH: join(__dirname, '..', '..', '..', 'node_modules') };
    const processes = Array.from({ length: WORKERS }, (_, i) =>
      run(process.execPath, [join(codeDir, 'claim-worker.js'), dbPath, `worker-${i}`, mode, startFile], {
        env,
      }),
    );
    setTimeout(() => writeFileSync(startFile, 'go'), 300);
    const outputs = await Promise.all(processes);
    return outputs.flatMap(({ stdout }) => JSON.parse(stdout) as Array<{ id: string; repositoryId: string }>);
  }

  it('hands out at most one running job per repository and never the same job twice', async () => {
    const claims = await race('hold');
    expect(claims).toHaveLength(REPOS.length);
    expect(new Set(claims.map((c) => c.id)).size).toBe(claims.length);
    expect(new Set(claims.map((c) => c.repositoryId))).toEqual(new Set(REPOS));
  });

  it('drains the whole queue with every job claimed exactly once', async () => {
    const claims = await race('complete');
    expect(claims).toHaveLength(REPOS.length * FILES.length);
    expect(new Set(claims.map((c) => c.id)).size).toBe(claims.length);
  });
});
