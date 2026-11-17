import { ScanCoverage } from '../../src/application/use-cases/scan-coverage';
import { CoverageThreshold } from '../../src/domain/coverage/coverage-threshold';
import { Repository } from '../../src/domain/repository/repository';
import { repoUrl } from '../support/builders';
import {
  FakeCoverageRunner,
  FakeGit,
  FakeWorkspace,
  FixedClock,
  InMemoryRepositoryRepository,
  RecordingLogger,
} from '../support/fakes';

describe('ScanCoverage', () => {
  const setup = async () => {
    const clock = new FixedClock();
    const repositories = new InMemoryRepositoryRepository();
    const workspace = new FakeWorkspace();
    const git = new FakeGit();
    const coverage = new FakeCoverageRunner();
    const logger = new RecordingLogger();
    const useCase = new ScanCoverage(
      repositories,
      workspace,
      git,
      coverage,
      clock,
      logger,
      CoverageThreshold.default(),
    );
    await repositories.save(Repository.register({ id: 'repo-1', url: repoUrl(), now: clock.now() }));
    return { clock, repositories, workspace, git, coverage, logger, useCase };
  };

  it('marks the repository as scanning, then stores the snapshot', async () => {
    const { useCase, repositories, workspace, git } = await setup();
    const result = await useCase.execute('repo-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repository.scanStatus).toBe('scanning');

    await result.value.completion;
    const repository = await repositories.findById('repo-1');
    expect(repository?.scanStatus).toBe('succeeded');
    expect(repository?.defaultBranch).toBe('main');
    expect(repository?.latestSnapshot?.commitSha).toBe('c0ffee0');
    expect(repository?.latestSnapshot?.files.map((f) => f.path.value)).toEqual(['src/ok.ts', 'src/price.ts']);
    expect(git.calls).toEqual(['clone', 'headCommit', 'currentBranch']);
    expect(workspace.removed).toEqual(workspace.created);
  });

  it('records a failure and still cleans the workspace', async () => {
    const { useCase, repositories, coverage, workspace } = await setup();
    coverage.failOn.installDependencies = new Error('npm ci exited with code 1');
    const result = await useCase.execute('repo-1');
    if (!result.ok) throw result.error;
    await result.value.completion;
    const repository = await repositories.findById('repo-1');
    expect(repository?.scanStatus).toBe('failed');
    expect(repository?.scanError).toBe('npm ci exited with code 1');
    expect(workspace.removed).toHaveLength(1);
  });

  it('records a failure when the workspace cannot be created', async () => {
    const { useCase, repositories, workspace } = await setup();
    workspace.failOnCreate = new Error('disk full');
    const result = await useCase.execute('repo-1');
    if (!result.ok) throw result.error;
    await result.value.completion;
    expect((await repositories.findById('repo-1'))?.scanError).toBe('disk full');
    expect(workspace.removed).toHaveLength(0);
  });

  it('rejects unknown repositories and concurrent scans', async () => {
    const { useCase } = await setup();
    const missing = await useCase.execute('nope');
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');

    const first = await useCase.execute('repo-1');
    const second = await useCase.execute('repo-1');
    expect(!second.ok && second.error.code).toBe('CONFLICT');
    if (first.ok) await first.value.completion;
  });

  it('does not overwrite a scan that was recovered as failed meanwhile', async () => {
    const { useCase, repositories, coverage, clock, logger } = await setup();
    coverage.failOn.measureRepository = new Error('jest crashed');
    const result = await useCase.execute('repo-1');
    // Simulate the reaper failing the scan while it was still running.
    const repository = await repositories.findById('repo-1');
    repository?.failScan('interrupted', clock.now());
    await repositories.save(repository!);
    if (result.ok) await result.value.completion;
    expect((await repositories.findById('repo-1'))?.scanError).toBe('interrupted');
    expect(logger.entries.some((e) => e.message === 'Scan failed')).toBe(true);
  });
});
