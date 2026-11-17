import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { AI_TEST_GENERATOR_PORT } from '../../src/application/ports/ai-test-generator.port';
import { JOB_QUEUE_PORT, JobQueuePort } from '../../src/application/ports/job-queue.port';
import { PULL_REQUEST_PORT } from '../../src/application/ports/pull-request.port';
import { JobView, RepositoryView } from '../../src/application/views';
import { createE2eApp, E2eContext, waitFor } from '../support/e2e-app';
import { gitOutput } from '../support/fixture-remote';
import { RecordingPullRequests, ScriptedAi } from '../support/scripted-ai';

const WORKER_ENV = {
  RUN_WORKER: 'true',
  WORKER_CONCURRENCY: '2',
  WORKER_POLL_INTERVAL_MS: '100',
  AI_MAX_FIX_ATTEMPTS: '1',
  KEEP_FAILED_WORKSPACES: 'false',
};

async function scannedRepository(http: App): Promise<string> {
  const registered = await request(http)
    .post('/repositories')
    .send({ url: 'https://github.com/acme/sample-lib' });
  const id = (registered.body as RepositoryView).id;
  await request(http).post(`/repositories/${id}/scan`).expect(202);
  await waitFor(
    async () => (await request(http).get(`/repositories/${id}`)).body as RepositoryView,
    (repo) => repo.scanStatus === 'succeeded',
  );
  return id;
}

const jobOf = (http: App, id: string) =>
  waitFor(
    async () => (await request(http).get(`/jobs/${id}`).expect(200)).body as JobView,
    (job) => job.status === 'completed' || job.status === 'failed',
  );

describe('Improvement jobs (e2e: real git, npm, Jest and verifier; scripted AI; recorded GitHub API)', () => {
  let ctx: E2eContext;
  let http: App;
  let ai: ScriptedAi;
  let pullRequests: RecordingPullRequests;

  beforeEach(async () => {
    ai = new ScriptedAi();
    pullRequests = new RecordingPullRequests();
    ctx = await createE2eApp(AppModule, WORKER_ENV, (builder) =>
      builder
        .overrideProvider(AI_TEST_GENERATOR_PORT)
        .useValue(ai)
        .overrideProvider(PULL_REQUEST_PORT)
        .useValue(pullRequests),
    );
    http = ctx.app.getHttpServer() as App;
  });
  afterEach(() => ctx.close());

  it('turns a request into a verified, pushed branch and a pull request', async () => {
    const repositoryId = await scannedRepository(http);
    const created = await request(http)
      .post('/jobs')
      .send({ repositoryId, filePath: 'src/strings.ts' })
      .expect(201);
    expect((created.body as JobView).status).toBe('queued');
    await request(http).post('/jobs').send({ repositoryId, filePath: 'src/strings.ts' }).expect(409);

    const job = await jobOf(http, (created.body as JobView).id);
    expect(job.error).toBeNull();
    expect(job.status).toBe('completed');
    expect(job.coverageBefore).toBe(0);
    expect(job.coverageAfter).toBe(100);
    expect(job.prUrl).toBe('https://github.com/acme/sample-lib/pull/1');
    expect(job.aiCostUsd).toBe(0.5); // planner + writer, 0.25 each
    expect(job.budget?.maxCostUsd).toBe(5);
    expect(job.timeline.map((e) => e.event)).toEqual([
      'queued',
      'running',
      'cloning',
      'planning',
      'writing',
      'verifying',
      'opening_pr',
      'completed',
    ]);

    // The branch exists on the remote and contains exactly the new test file (CLAUDE.md deletion not committed).
    const branch = job.branchName!;
    const files = gitOutput(ctx.remote.bareRepo, 'diff', '--name-status', 'main', branch);
    expect(files).toBe('A\tsrc/strings.test.ts');
    expect(gitOutput(ctx.remote.bareRepo, 'log', '-1', '--format=%an <%ae>', branch)).toBe(
      'TS Coverage Improver <coverage-improver@users.noreply.github.com>',
    );

    expect(pullRequests.opened).toHaveLength(1);
    expect(pullRequests.opened[0]).toMatchObject({ head: branch, base: 'main' });
    expect(pullRequests.opened[0].body).toContain('| Lines | 0.00% | 100.00% | +100.00 pp |');
    expect(pullRequests.opened[0].body).toContain('| Branches | 0.00% | 100.00% | +100.00 pp |');
    expect(pullRequests.opened[0].body).toContain('pass in 2 consecutive runs');
    expect(pullRequests.opened[0].body).toContain('AI cost $0.50');

    const files2 = await request(http).get(`/repositories/${repositoryId}/files`).expect(200);
    const strings = (files2.body as Array<{ path: string; latestJob: JobView | null }>).find(
      (f) => f.path === 'src/strings.ts',
    );
    expect(strings?.latestJob?.status).toBe('completed');
    const jobs = await request(http).get(`/repositories/${repositoryId}/jobs`).expect(200);
    expect((jobs.body as JobView[]).map((j) => j.id)).toEqual([job.id]);
  });

  it('reverts source files the AI touched, verifies only its tests and records the revert', async () => {
    ai.extraWrites = {
      'src/strings.ts': 'export const capitalize = (s: string) => s;\n',
      'src/sneaky.ts': 'export const x = 1;\n',
    };
    const repositoryId = await scannedRepository(http);
    const created = await request(http)
      .post('/jobs')
      .send({ repositoryId, filePath: 'src/strings.ts' })
      .expect(201);

    const job = await jobOf(http, (created.body as JobView).id);
    expect(job.error).toBeNull();
    expect(job.status).toBe('completed');
    expect(job.revertedFiles).toEqual(['src/sneaky.ts', 'src/strings.ts']);
    expect(pullRequests.opened[0].body).toContain('2 non-test edits were made by the AI and reverted');
    expect(ai.calls).toEqual(['plan', 'write']);
    // Only the test reached the remote; the original source is intact there.
    expect(gitOutput(ctx.remote.bareRepo, 'diff', '--name-status', 'main', job.branchName!)).toBe(
      'A\tsrc/strings.test.ts',
    );
  });

  it('fails the job when the generated tests do not pass', async () => {
    ai.testContent = `import { capitalize } from './strings';\nit('is wrong', () => { expect(capitalize('a')).toBe('b'); });\n`;
    const repositoryId = await scannedRepository(http);
    const created = await request(http)
      .post('/jobs')
      .send({ repositoryId, filePath: 'src/strings.ts' })
      .expect(201);
    const job = await jobOf(http, (created.body as JobView).id);
    expect(job.status).toBe('failed');
    expect(job.error).toContain('Tests are failing.');
  });

  it('validates job requests', async () => {
    const repositoryId = await scannedRepository(http);
    await request(http).post('/jobs').send({ repositoryId }).expect(400);
    await request(http).post('/jobs').send({ repositoryId, filePath: '../../etc/passwd.ts' }).expect(400);
    await request(http).post('/jobs').send({ repositoryId, filePath: 'src/nope.ts' }).expect(404);
    await request(http).post('/jobs').send({ repositoryId: 'nope', filePath: 'src/strings.ts' }).expect(404);
    await request(http).get('/jobs/nope').expect(404);
    await request(http).get('/repositories/nope/jobs').expect(404);
  });
});

describe('Crash recovery across a restart (e2e)', () => {
  it('requeues a job orphaned by a crashed worker on startup and completes it', async () => {
    // 1st process: API only. A "worker" claims the job and dies (we claim directly and never heartbeat).
    const first = await createE2eApp(AppModule, { RUN_WORKER: 'false' });
    const http1 = first.app.getHttpServer() as App;
    const repositoryId = await scannedRepository(http1);
    const created = await request(http1)
      .post('/jobs')
      .send({ repositoryId, filePath: 'src/strings.ts' })
      .expect(201);
    const jobId = (created.body as JobView).id;
    const claimed = await first.app.get<JobQueuePort>(JOB_QUEUE_PORT).claimNext('crashed-worker', 1);
    expect(claimed?.id).toBe(jobId);
    await first.close({ keepData: true });

    // 2nd process: worker enabled. The startup reaper requeues the expired job, a slot completes it.
    const ai = new ScriptedAi();
    const second = await createE2eApp(
      AppModule,
      WORKER_ENV,
      (builder) =>
        builder
          .overrideProvider(AI_TEST_GENERATOR_PORT)
          .useValue(ai)
          .overrideProvider(PULL_REQUEST_PORT)
          .useValue(new RecordingPullRequests()),
      { remote: first.remote, dataDir: first.dataDir },
    );
    try {
      const job = await jobOf(second.app.getHttpServer() as App, jobId);
      expect(job.status).toBe('completed');
      expect(job.attempts).toBe(2);
      expect(job.timeline.map((e) => e.event)).toContain('requeued');
    } finally {
      await second.close();
    }
  });
});
