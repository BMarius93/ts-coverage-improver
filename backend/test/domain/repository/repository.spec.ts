import { Repository } from '../../../src/domain/repository/repository';
import { IllegalStateTransitionError, ValidationError } from '../../../src/domain/shared/domain-error';
import { at, repoUrl, snapshot, T0 } from '../../support/builders';

const register = () => Repository.register({ id: 'repo-1', url: repoUrl(), now: T0 });

describe('Repository', () => {
  it('is registered without a scan', () => {
    const repo = register();
    expect(repo.id).toBe('repo-1');
    expect(repo.url.fullName).toBe('acme/widgets');
    expect(repo.scanStatus).toBe('never_scanned');
    expect(repo.latestSnapshot).toBeNull();
    expect(repo.defaultBranch).toBeNull();
    expect(repo.createdAt).toEqual(T0);
    expect(repo.updatedAt).toEqual(T0);
  });

  it('requires an id', () => {
    expect(() => Repository.register({ id: ' ', url: repoUrl(), now: T0 })).toThrow(ValidationError);
  });

  it('records a successful scan', () => {
    const repo = register();
    repo.startScan(at(1));
    expect(repo.isScanning).toBe(true);
    expect(repo.scanStartedAt).toEqual(at(1));
    const snap = snapshot([['src/a.ts', 10]]);
    repo.completeScan({ snapshot: snap, defaultBranch: 'main', now: at(2) });
    expect(repo.scanStatus).toBe('succeeded');
    expect(repo.latestSnapshot).toBe(snap);
    expect(repo.defaultBranch).toBe('main');
    expect(repo.updatedAt).toEqual(at(2));
  });

  it('records a failed scan and clears the error on the next scan', () => {
    const repo = register();
    repo.startScan(at(1));
    repo.failScan('npm ci failed', at(2));
    expect(repo.scanStatus).toBe('failed');
    expect(repo.scanError).toBe('npm ci failed');
    repo.startScan(at(3));
    expect(repo.scanError).toBeNull();
  });

  it('rejects illegal scan transitions', () => {
    const repo = register();
    expect(() => repo.completeScan({ snapshot: snapshot([]), defaultBranch: 'main', now: at(1) })).toThrow(
      IllegalStateTransitionError,
    );
    expect(() => repo.failScan('x', at(1))).toThrow(IllegalStateTransitionError);
    repo.startScan(at(1));
    expect(() => repo.startScan(at(2))).toThrow(IllegalStateTransitionError);
    expect(() => repo.completeScan({ snapshot: snapshot([]), defaultBranch: ' ', now: at(1) })).toThrow(
      ValidationError,
    );
  });

  it('detects stale scans', () => {
    const repo = register();
    expect(repo.isScanStale(at(1000), 10_000)).toBe(false);
    repo.startScan(at(0));
    expect(repo.isScanStale(at(10), 10_000)).toBe(false);
    expect(repo.isScanStale(at(11), 10_000)).toBe(true);
  });

  it('can be reconstituted from persisted state', () => {
    const repo = register();
    const copy = Repository.reconstitute({
      id: repo.id,
      url: repo.url,
      defaultBranch: 'main',
      scanStatus: 'failed',
      scanError: 'boom',
      scanStartedAt: T0,
      latestSnapshot: null,
      createdAt: T0,
      updatedAt: T0,
    });
    expect(copy.scanError).toBe('boom');
    expect(copy.defaultBranch).toBe('main');
  });
});
