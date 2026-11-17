import {
  CoverageAnalyzer,
  NotAnImprovementCandidateError,
} from '../../../src/domain/coverage/coverage-analyzer';
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

  it('never offers re-export-only files, even at 0%, but reports them as skipped', () => {
    const snap = snapshot([
      ['src/index.ts', 0, 're-export-only'],
      ['src/lib/index.ts', 95, 're-export-only'],
      ['src/price.ts', 10],
      ['src/ok.ts', 90],
    ]);
    const analysis = analyzer.analyze(snap, CoverageThreshold.default());
    expect(analysis.candidates.map((f) => f.path.value)).toEqual(['src/price.ts']);
    expect(analysis.skipped.map((s) => [s.file.path.value, s.reason])).toEqual([
      ['src/index.ts', 're-exports only'],
    ]);
    expect(
      analyzer.filesNeedingImprovement(snap, CoverageThreshold.default()).map((f) => f.path.value),
    ).toEqual(['src/price.ts']);
  });

  it('rejects improving a re-export-only file and accepts a module', () => {
    const barrel = fileCoverage('src/index.ts', 0, 're-export-only');
    const result = analyzer.assertImprovable(barrel);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(NotAnImprovementCandidateError);
      expect(result.error.code).toBe('NOT_AN_IMPROVEMENT_CANDIDATE');
      expect(result.error.message).toBe('src/index.ts is not an improvement candidate: re-exports only');
    }
    expect(analyzer.assertImprovable(fileCoverage('src/a.ts', 0)).ok).toBe(true);
    expect(analyzer.skipReason(barrel)).toBe('re-exports only');
    expect(analyzer.needsImprovement(barrel, CoverageThreshold.default())).toBe(false);
  });

  it('defaults files to modules and can reclassify them', () => {
    const file = fileCoverage('src/a.ts', 10);
    expect(file.kind).toBe('module');
    expect(file.isReExportOnly).toBe(false);
    const barrel = file.withKind('re-export-only');
    expect(barrel.isReExportOnly).toBe(true);
    expect(barrel.metrics).toBe(file.metrics);
  });

  it('tells whether a single file needs improvement', () => {
    expect(analyzer.needsImprovement(fileCoverage('src/a.ts', 79), CoverageThreshold.default())).toBe(true);
    expect(analyzer.needsImprovement(fileCoverage('src/a.ts', 81), CoverageThreshold.default())).toBe(false);
  });
});
