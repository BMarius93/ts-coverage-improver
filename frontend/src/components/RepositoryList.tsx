import { formatPercent } from '../lib/format';
import type { Repository } from '../lib/types';

interface Props {
  repositories: Repository[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onScan: (id: string) => void;
}

const SCAN_LABEL: Record<Repository['scanStatus'], string> = {
  never_scanned: 'Not scanned',
  scanning: 'Scanning…',
  succeeded: 'Scanned',
  failed: 'Scan failed',
};

export function RepositoryList({ repositories, selectedId, onSelect, onScan }: Props) {
  if (repositories.length === 0) {
    return <p className="empty">No repositories yet. Add one above to get started.</p>;
  }
  return (
    <ul className="repo-list">
      {repositories.map((repo) => {
        const snapshot = repo.latestSnapshot;
        return (
          <li key={repo.id} className={repo.id === selectedId ? 'repo selected' : 'repo'}>
            <button type="button" className="repo-main" onClick={() => onSelect(repo.id)}>
              <span className="repo-name">
                {repo.owner}/<strong>{repo.name}</strong>
              </span>
              <span className={`scan scan-${repo.scanStatus}`}>
                {repo.scanStatus === 'scanning' && <span className="spinner" aria-hidden />}
                {SCAN_LABEL[repo.scanStatus]}
              </span>
              {snapshot && (
                <span className="repo-stats">
                  avg {formatPercent(snapshot.averageLineCoverage)} · {snapshot.filesBelowThreshold}/
                  {snapshot.fileCount} files below {repo.threshold}%
                  {snapshot.filesSkipped > 0 && ` (${snapshot.filesSkipped} skipped)`}
                </span>
              )}
              {repo.scanStatus === 'failed' && repo.scanError && (
                <span className="repo-error" title={repo.scanError}>
                  {repo.scanError}
                </span>
              )}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={repo.scanStatus === 'scanning'}
              onClick={() => onScan(repo.id)}
            >
              {repo.scanStatus === 'never_scanned' ? 'Scan' : 'Rescan'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
