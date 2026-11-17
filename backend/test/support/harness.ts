import { AiMode, ProcessNextJob } from '../../src/application/use-cases/process-next-job';
import { RecoverStaleJobs } from '../../src/application/use-cases/recover-stale-jobs';
import { RequestImprovement } from '../../src/application/use-cases/request-improvement';
import { CoverageThreshold } from '../../src/domain/coverage/coverage-threshold';
import { Repository } from '../../src/domain/repository/repository';
import { repoUrl, snapshot } from './builders';
import {
  FakeAi,
  FakeCoverageRunner,
  FakeGit,
  FakeLeaseKeeper,
  FakePullRequests,
  FakeWorkspace,
  FixedClock,
  InMemoryJobStore,
  InMemoryRepositoryRepository,
  RecordingLogger,
  SequentialIds,
} from './fakes';

export const LEASE_MS = 60_000;

/** All fakes wired together, plus helpers to seed a scanned repository and queue jobs. */
export function createHarness(
  options: { aiMode?: AiMode; maxFixAttempts?: number; keepFailedWorkspaces?: boolean } = {},
) {
  const clock = new FixedClock();
  const ids = new SequentialIds('job');
  const repositories = new InMemoryRepositoryRepository();
  const jobs = new InMemoryJobStore(clock);
  const workspace = new FakeWorkspace();
  const git = new FakeGit();
  const coverage = new FakeCoverageRunner();
  const ai = new FakeAi();
  const pullRequests = new FakePullRequests();
  const leaseKeeper = new FakeLeaseKeeper();
  const logger = new RecordingLogger();

  const processNextJob = new ProcessNextJob(
    {
      jobs,
      queue: jobs,
      repositories,
      workspace,
      git,
      coverage,
      ai,
      pullRequests,
      leaseKeeper,
      clock,
      logger,
    },
    {
      aiMode: options.aiMode ?? 'plan-and-write',
      maxFixAttempts: options.maxFixAttempts ?? 2,
      leaseMs: LEASE_MS,
      keepFailedWorkspaces: options.keepFailedWorkspaces ?? false,
    },
  );
  const requestImprovement = new RequestImprovement(repositories, jobs, ids, clock);
  const recoverStaleJobs = new RecoverStaleJobs(jobs, jobs, repositories, clock, logger, {
    maxAttempts: 2,
    maxScanDurationMs: 30 * 60_000,
  });

  async function seedRepository(id = 'repo-1', url = 'https://github.com/acme/widgets'): Promise<Repository> {
    const repository = Repository.register({ id, url: repoUrl(url), now: clock.now() });
    repository.startScan(clock.now());
    repository.completeScan({
      snapshot: snapshot([
        ['src/price.ts', 10],
        ['src/cache.ts', 20],
        ['src/ok.ts', 95],
      ]),
      defaultBranch: 'main',
      now: clock.now(),
    });
    await repositories.save(repository);
    return repository;
  }

  async function queue(filePath = 'src/price.ts', repositoryId = 'repo-1'): Promise<string> {
    const result = await requestImprovement.execute({ repositoryId, filePath });
    if (!result.ok) throw result.error;
    clock.advance(1000);
    return result.value.id;
  }

  return {
    clock,
    ids,
    repositories,
    jobs,
    workspace,
    git,
    coverage,
    ai,
    pullRequests,
    leaseKeeper,
    logger,
    processNextJob,
    requestImprovement,
    recoverStaleJobs,
    seedRepository,
    queue,
    threshold: CoverageThreshold.default(),
  };
}

export type Harness = ReturnType<typeof createHarness>;
