import { CoverageSnapshot } from '../coverage/coverage-snapshot';
import { IllegalStateTransitionError, ValidationError } from '../shared/domain-error';
import { GitHubRepoUrl } from './github-repo-url';

export type ScanStatus = 'never_scanned' | 'scanning' | 'succeeded' | 'failed';

export interface RepositoryProps {
  id: string;
  url: GitHubRepoUrl;
  defaultBranch: string | null;
  scanStatus: ScanStatus;
  scanError: string | null;
  scanStartedAt: Date | null;
  latestSnapshot: CoverageSnapshot | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregate root for a registered GitHub repository and its latest coverage snapshot.
 *
 * Scan lifecycle: never_scanned|succeeded|failed --startScan--> scanning --completeScan--> succeeded
 *                                                                        --failScan-----> failed
 */
export class Repository {
  private constructor(private props: RepositoryProps) {}

  static register(params: { id: string; url: GitHubRepoUrl; now: Date }): Repository {
    if (params.id.trim() === '') {
      throw new ValidationError('Repository id is required');
    }
    return new Repository({
      id: params.id,
      url: params.url,
      defaultBranch: null,
      scanStatus: 'never_scanned',
      scanError: null,
      scanStartedAt: null,
      latestSnapshot: null,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  /** Rebuilds an aggregate from persistence; the data is trusted to already satisfy invariants. */
  static reconstitute(props: RepositoryProps): Repository {
    return new Repository({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get url(): GitHubRepoUrl {
    return this.props.url;
  }
  get defaultBranch(): string | null {
    return this.props.defaultBranch;
  }
  get scanStatus(): ScanStatus {
    return this.props.scanStatus;
  }
  get scanError(): string | null {
    return this.props.scanError;
  }
  get scanStartedAt(): Date | null {
    return this.props.scanStartedAt;
  }
  get latestSnapshot(): CoverageSnapshot | null {
    return this.props.latestSnapshot;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get isScanning(): boolean {
    return this.props.scanStatus === 'scanning';
  }

  startScan(now: Date): void {
    if (this.isScanning) {
      throw new IllegalStateTransitionError('Repository', this.props.scanStatus, 'start a scan');
    }
    this.props = {
      ...this.props,
      scanStatus: 'scanning',
      scanError: null,
      scanStartedAt: now,
      updatedAt: now,
    };
  }

  completeScan(params: { snapshot: CoverageSnapshot; defaultBranch: string; now: Date }): void {
    if (!this.isScanning) {
      throw new IllegalStateTransitionError('Repository', this.props.scanStatus, 'complete a scan');
    }
    if (params.defaultBranch.trim() === '') {
      throw new ValidationError('Default branch is required');
    }
    this.props = {
      ...this.props,
      scanStatus: 'succeeded',
      latestSnapshot: params.snapshot,
      defaultBranch: params.defaultBranch,
      updatedAt: params.now,
    };
  }

  failScan(reason: string, now: Date): void {
    if (!this.isScanning) {
      throw new IllegalStateTransitionError('Repository', this.props.scanStatus, 'fail a scan');
    }
    this.props = { ...this.props, scanStatus: 'failed', scanError: reason, updatedAt: now };
  }

  /** A scan is stale when its process most likely died (e.g. a crash) and it will never finish. */
  isScanStale(now: Date, maxScanDurationMs: number): boolean {
    return (
      this.isScanning &&
      this.props.scanStartedAt !== null &&
      now.getTime() - this.props.scanStartedAt.getTime() > maxScanDurationMs
    );
  }
}
