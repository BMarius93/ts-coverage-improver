import {
  PullRequestDescription,
  PullRequestDescriptionInput,
} from '../../../src/application/services/pull-request-description';
import { TestPlan } from '../../../src/domain/job/test-plan';
import { unwrap } from '../../../src/domain/shared/result';
import { path, pct, plan } from '../../support/builders';

const input = (overrides: Partial<PullRequestDescriptionInput> = {}): PullRequestDescriptionInput => ({
  jobId: 'job-1',
  targetFile: path('src/price.ts'),
  coverageBefore: pct(10),
  coverageAfter: pct(85.5),
  branchesBefore: pct(20),
  branchesAfter: pct(75),
  plan: plan(),
  testFiles: ['src/price.test.ts'],
  verificationRuns: 2,
  revertedFiles: [],
  aiCostUsd: 1.234,
  ...overrides,
});

describe('PullRequestDescription', () => {
  it('builds the title and commit message', () => {
    const description = new PullRequestDescription(input());
    expect(description.title).toBe('test: improve coverage of src/price.ts (10.00% → 85.50%)');
    expect(description.commitMessage).toContain('job job-1');
  });

  it('reports line and branch coverage, verification runs, the plan and the AI cost', () => {
    const body = new PullRequestDescription(input()).body;
    expect(body).toContain('| Lines | 10.00% | 85.50% | +75.50 pp |');
    expect(body).toContain('| Branches | 20.00% | 75.00% | +55.00 pp |');
    expect(body).toContain('pass in 2 consecutive runs with identical coverage');
    expect(body).toContain('| applies a percentage discount | lines 10-20 |');
    expect(body).toContain('- `src/price.test.ts`');
    expect(body).toContain('AI cost $1.23');
    expect(body).not.toContain('reverted');
  });

  it('shows a decrease in branch coverage honestly and a single verification run', () => {
    const body = new PullRequestDescription(input({ branchesAfter: pct(15), verificationRuns: 1 })).body;
    expect(body).toContain('| Branches | 20.00% | 15.00% | -5.00 pp |');
    expect(body).toContain('- the related Jest tests pass;');
  });

  it('lists reverted non-test edits', () => {
    const one = new PullRequestDescription(input({ revertedFiles: ['src/price.ts'] })).body;
    expect(one).toContain('1 non-test edit was made by the AI and reverted before verification');
    const two = new PullRequestDescription(input({ revertedFiles: ['src/a.ts', 'src/b.ts'] })).body;
    expect(two).toContain('2 non-test edits were made by the AI and reverted before verification');
    expect(two).toContain('- `src/b.ts`');
  });

  it('escapes pipes and newlines in table cells', () => {
    const tricky = unwrap(
      TestPlan.create({
        testFilePath: 'src/price.test.ts',
        summary: 's',
        cases: [{ name: 'a | b', covers: 'line 1\nline 2' }],
      }),
    );
    expect(new PullRequestDescription(input({ plan: tricky })).body).toContain('| a \\| b | line 1 line 2 |');
  });
});
