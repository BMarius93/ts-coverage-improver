import { ChangedFile, ImprovementVerifier } from '../../../src/domain/job/improvement-verifier';
import { pct } from '../../support/builders';

describe('ImprovementVerifier', () => {
  const verifier = new ImprovementVerifier();
  const base = {
    changedFiles: [{ path: 'src/price.test.ts', kind: 'added' }] as ChangedFile[],
    expectedDeletions: ['.claude', 'CLAUDE.md'],
    testsPassed: true,
    coverageBefore: pct(10),
    coverageAfter: pct(60),
  };

  it('passes when only tests changed, tests pass and coverage increased', () => {
    expect(verifier.verify(base)).toEqual({ passed: true, failures: [] });
  });

  it('ignores the deletions made by workspace hardening', () => {
    const result = verifier.verify({
      ...base,
      changedFiles: [
        ...base.changedFiles,
        { path: 'CLAUDE.md', kind: 'deleted' },
        { path: '.claude/settings.json', kind: 'deleted' },
      ],
    });
    expect(result.passed).toBe(true);
  });

  it('fails when a source file changed', () => {
    const result = verifier.verify({
      ...base,
      changedFiles: [...base.changedFiles, { path: 'src/price.ts', kind: 'modified' }],
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(['Only *.test.ts files may change, but src/price.ts was modified.']);
  });

  it('fails when a test file was deleted', () => {
    const result = verifier.verify({ ...base, changedFiles: [{ path: 'src/old.test.ts', kind: 'deleted' }] });
    expect(result.failures).toContain('File was deleted: src/old.test.ts');
  });

  it('fails when nothing changed', () => {
    expect(verifier.verify({ ...base, changedFiles: [] }).failures).toContain(
      'No test file was created or modified.',
    );
  });

  it('fails when tests fail', () => {
    expect(verifier.verify({ ...base, testsPassed: false }).failures).toEqual(['Tests are failing.']);
  });

  it('fails when coverage did not increase or could not be measured', () => {
    expect(verifier.verify({ ...base, coverageAfter: pct(10) }).failures[0]).toMatch(/did not increase/);
    expect(verifier.verify({ ...base, coverageAfter: null }).failures[0]).toMatch(/could not be measured/);
  });

  it('collects every failure at once', () => {
    const result = verifier.verify({
      ...base,
      changedFiles: [{ path: 'package.json', kind: 'modified' }],
      testsPassed: false,
      coverageAfter: pct(5),
    });
    expect(result.failures).toHaveLength(3);
  });

  it('selects added or modified test files to commit', () => {
    const files: ChangedFile[] = [
      { path: 'src/b.test.ts', kind: 'modified' },
      { path: 'src/a.test.tsx', kind: 'added' },
      { path: 'CLAUDE.md', kind: 'deleted' },
      { path: 'src/c.test.ts', kind: 'deleted' },
      { path: 'src/x.ts', kind: 'modified' },
    ];
    expect(verifier.testFilesToCommit(files)).toEqual(['src/a.test.tsx', 'src/b.test.ts']);
  });
});
