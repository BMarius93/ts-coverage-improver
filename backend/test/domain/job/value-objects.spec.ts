import { PullRequestUrl } from '../../../src/domain/job/pull-request-url';
import { TestPlan } from '../../../src/domain/job/test-plan';
import { canAdvance, isJobPhase, isJobStatus } from '../../../src/domain/job/job-status';

describe('TestPlan', () => {
  const valid = {
    testFilePath: 'src/price.test.ts',
    summary: ' Cover discounts ',
    cases: [{ name: ' applies discount ', covers: ' lines 1-3 ' }],
  };

  it('accepts a valid plan and trims text', () => {
    const result = TestPlan.create(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.testFile.value).toBe('src/price.test.ts');
      expect(result.value.toProps()).toEqual({
        testFilePath: 'src/price.test.ts',
        summary: 'Cover discounts',
        cases: [{ name: 'applies discount', covers: 'lines 1-3' }],
      });
    }
  });

  it.each([
    ['non-test file', { ...valid, testFilePath: 'src/price.ts' }],
    ['spec file', { ...valid, testFilePath: 'src/price.spec.ts' }],
    ['escaping path', { ...valid, testFilePath: '../price.test.ts' }],
    ['empty summary', { ...valid, summary: '  ' }],
    ['no cases', { ...valid, cases: [] }],
    ['too many cases', { ...valid, cases: Array.from({ length: 51 }, () => valid.cases[0]) }],
    ['unnamed case', { ...valid, cases: [{ name: ' ', covers: 'x' }] }],
    ['huge description', { ...valid, cases: [{ name: 'a', covers: 'x'.repeat(2001) }] }],
  ])('rejects a plan with %s', (_label, props) => {
    expect(TestPlan.create(props).ok).toBe(false);
  });
});

describe('PullRequestUrl', () => {
  it('parses the PR number', () => {
    const result = PullRequestUrl.create('https://github.com/acme/widgets/pull/42');
    expect(result.ok && result.value.number).toBe(42);
    expect(result.ok && result.value.toString()).toBe('https://github.com/acme/widgets/pull/42');
  });

  it.each(['https://github.com/acme/widgets/issues/42', 'https://evil.com/acme/widgets/pull/1', 'nope'])(
    'rejects %p',
    (value) => {
      expect(PullRequestUrl.create(value).ok).toBe(false);
    },
  );
});

describe('job status helpers', () => {
  it('knows statuses and phases', () => {
    expect(isJobStatus('queued')).toBe(true);
    expect(isJobStatus('paused')).toBe(false);
    expect(isJobPhase('fixing')).toBe(true);
    expect(isJobPhase('deploying')).toBe(false);
  });

  it('knows legal phase transitions', () => {
    expect(canAdvance('verifying', 'fixing')).toBe(true);
    expect(canAdvance('opening_pr', 'cloning')).toBe(false);
  });
});
