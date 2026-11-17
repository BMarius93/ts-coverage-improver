import { CoverageAnalyzer } from '../../../src/domain/coverage/coverage-analyzer';
import { CoverageSnapshot } from '../../../src/domain/coverage/coverage-snapshot';
import { CoverageThreshold } from '../../../src/domain/coverage/coverage-threshold';
import { fileCoverage, path, snapshot, T0 } from '../../support/builders';

describe('CoverageSnapshot', () => {
  it('rejects an invalid commit SHA', () => {
    expect(CoverageSnapshot.create({ commitSha: 'not-a-sha', takenAt: T0, files: [] }).ok).toBe(false);
  });

  it('rejects duplicate files', () => {
    const result = CoverageSnapshot.create({
      commitSha: 'abcdef1',
      takenAt: T0,
      files: [fileCoverage('src/a.ts', 1), fileCoverage('src/a.ts', 2)],
    });
    expect(result.ok).toBe(false);
  });

  it('sorts files by path and finds them', () => {
    const snap = snapshot([
      ['src/b.ts', 10],
      ['src/a.ts', 20],
    ]);
    expect(snap.files.map((f) => f.path.value)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(snap.fileFor(path('src/b.ts'))?.lines.value).toBe(10);
    expect(snap.fileFor(path('src/c.ts'))).toBeUndefined();
  });
});

describe('CoverageAnalyzer', () => {
  const analyzer = new CoverageAnalyzer();

  it('returns files below the threshold, lowest coverage first, ties by path', () => {
    const snap = snapshot([
      ['src/high.ts', 95],
      ['src/edge.ts', 80],
      ['src/mid.ts', 50],
      ['src/zero-b.ts', 0],
      ['src/zero-a.ts', 0],
    ]);
    const result = analyzer.filesNeedingImprovement(snap, CoverageThreshold.default());
    expect(result.map((f) => f.path.value)).toEqual(['src/zero-a.ts', 'src/zero-b.ts', 'src/mid.ts']);
  });

  it('ignores test and declaration files', () => {
    const snap = snapshot([
      ['src/a.test.ts', 0],
      ['src/types.d.ts', 0],
      ['src/a.ts', 10],
    ]);
    expect(
      analyzer.filesNeedingImprovement(snap, CoverageThreshold.default()).map((f) => f.path.value),
    ).toEqual(['src/a.ts']);
  });

  it('tells whether a single file needs improvement', () => {
    expect(analyzer.needsImprovement(fileCoverage('src/a.ts', 79), CoverageThreshold.default())).toBe(true);
    expect(analyzer.needsImprovement(fileCoverage('src/a.ts', 81), CoverageThreshold.default())).toBe(false);
  });
});
