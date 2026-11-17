import { formatPercent, improveAction } from '../lib/format';
import type { FileRow, Repository } from '../lib/types';
import { CoverageBar } from './CoverageBar';
import { JobBadge } from './JobBadge';

interface Props {
  repository: Repository;
  files: FileRow[];
  belowOnly: boolean;
  onToggleBelowOnly: (value: boolean) => void;
  onImprove: (path: string) => void;
  onOpenJob: (jobId: string) => void;
}

export function FilesTable({ repository, files, belowOnly, onToggleBelowOnly, onImprove, onOpenJob }: Props) {
  return (
    <section className="files">
      <header className="files-header">
        <h2>
          {repository.owner}/{repository.name}
          {repository.latestSnapshot && (
            <span className="muted"> · {repository.latestSnapshot.commitSha.slice(0, 7)}</span>
          )}
        </h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={belowOnly}
            onChange={(event) => onToggleBelowOnly(event.target.checked)}
          />
          Only files below {repository.threshold}%
        </label>
      </header>

      {!repository.latestSnapshot ? (
        <p className="empty">
          {repository.scanStatus === 'scanning'
            ? 'Scanning: cloning, installing dependencies and running Jest…'
            : 'Scan the repository to see its coverage.'}
        </p>
      ) : files.length === 0 ? (
        <p className="empty">
          {belowOnly ? 'Every file meets the threshold. 🎉' : 'No TypeScript files found.'}
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th className="col-coverage">Lines</th>
              <th className="col-small">Branches</th>
              <th className="col-small">Functions</th>
              <th>Latest job</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.map((file) => {
              const job = file.latestJob;
              return (
                <tr key={file.path} className={file.skippedReason ? 'skipped' : undefined}>
                  <td className="path">
                    {file.path}
                    {file.skippedReason && (
                      <span
                        className="skip-label"
                        title="Files that only re-export other modules have no logic of their own to test"
                      >
                        skipped: {file.skippedReason}
                      </span>
                    )}
                  </td>
                  <td>
                    <CoverageBar value={file.lines} threshold={repository.threshold} />
                  </td>
                  <td className="col-small">{formatPercent(file.branches)}</td>
                  <td className="col-small">{formatPercent(file.functions)}</td>
                  <td>
                    {job ? (
                      <div className="job-cell">
                        <JobBadge job={job} onClick={() => onOpenJob(job.id)} />
                        {job.status === 'completed' && (
                          <span className="coverage-delta" title="Line coverage before → after">
                            {formatPercent(job.coverageBefore)} → {formatPercent(job.coverageAfter)}
                          </span>
                        )}
                        {job.prUrl && (
                          <a href={job.prUrl} target="_blank" rel="noreferrer">
                            PR #{job.prUrl.split('/').pop()}
                          </a>
                        )}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="actions">
                    {improveAction(file) !== 'hidden' && (
                      <button
                        type="button"
                        disabled={improveAction(file) === 'disabled'}
                        onClick={() => onImprove(file.path)}
                        title={
                          file.belowThreshold ? 'Generate tests and open a PR' : 'Already above the threshold'
                        }
                        className={file.belowThreshold ? '' : 'secondary'}
                      >
                        Improve
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
