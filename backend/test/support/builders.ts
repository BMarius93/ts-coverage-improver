import { CoveragePercentage } from '../../src/domain/coverage/coverage-percentage';
import { CoverageSnapshot } from '../../src/domain/coverage/coverage-snapshot';
import { FileCoverage } from '../../src/domain/coverage/file-coverage';
import { FilePath } from '../../src/domain/coverage/file-path';
import { ImprovementJob } from '../../src/domain/job/improvement-job';
import { TestPlan } from '../../src/domain/job/test-plan';
import { GitHubRepoUrl } from '../../src/domain/repository/github-repo-url';
import { unwrap } from '../../src/domain/shared/result';

export const T0 = new Date('2026-01-01T10:00:00.000Z');

export const at = (secondsAfterT0: number): Date => new Date(T0.getTime() + secondsAfterT0 * 1000);

export const pct = (value: number): CoveragePercentage => unwrap(CoveragePercentage.create(value));

export const path = (value: string): FilePath => unwrap(FilePath.create(value));

export const repoUrl = (value = 'https://github.com/acme/widgets'): GitHubRepoUrl =>
  unwrap(GitHubRepoUrl.create(value));

export const fileCoverage = (file: string, lines: number): FileCoverage =>
  new FileCoverage(path(file), {
    lines: pct(lines),
    branches: pct(lines),
    functions: pct(lines),
    statements: pct(lines),
  });

export const snapshot = (files: Array<[string, number]>, commitSha = 'a'.repeat(40)): CoverageSnapshot =>
  unwrap(
    CoverageSnapshot.create({ commitSha, takenAt: T0, files: files.map(([f, l]) => fileCoverage(f, l)) }),
  );

export const plan = (testFilePath = 'src/price.test.ts'): TestPlan =>
  unwrap(
    TestPlan.create({
      testFilePath,
      summary: 'Cover discount branches',
      cases: [{ name: 'applies a percentage discount', covers: 'lines 10-20' }],
    }),
  );

export const queuedJob = (
  overrides: { id?: string; repositoryId?: string; file?: string; now?: Date } = {},
) =>
  ImprovementJob.request({
    id: overrides.id ?? 'job-00000001',
    repositoryId: overrides.repositoryId ?? 'repo-1',
    targetFile: path(overrides.file ?? 'src/price.ts'),
    now: overrides.now ?? T0,
  });
