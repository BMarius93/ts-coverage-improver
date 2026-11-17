import { eventLabel, formatDuration, formatPercent, formatTime, formatUsd, jobLabel } from '../lib/format';
import type { Job } from '../lib/types';

export function JobDrawer({ job, onClose }: { job: Job | null; onClose: () => void }) {
  if (!job) return null;
  const end = job.finishedAt ?? new Date().toISOString();
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()} aria-label="Job details">
        <header className="drawer-header">
          <div>
            <h3>{job.targetFile}</h3>
            <span className={`badge badge-${job.status}`}>{jobLabel(job)}</span>
          </div>
          <button type="button" className="secondary" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <dl className="facts">
          <dt>Coverage</dt>
          <dd>
            {formatPercent(job.coverageBefore)} → {formatPercent(job.coverageAfter)}
          </dd>
          <dt>AI cost</dt>
          <dd>
            AI cost: {formatUsd(job.aiCostUsd)}
            {job.budget && <span className="muted"> of {formatUsd(job.budget.maxCostUsd)} budget</span>}
          </dd>
          <dt>Attempt</dt>
          <dd>
            {job.attempts} {job.fixAttempts > 0 && `(fix rounds: ${job.fixAttempts})`}
          </dd>
          {job.branchName && (
            <>
              <dt>Branch</dt>
              <dd className="mono">{job.branchName}</dd>
            </>
          )}
          {job.startedAt && (
            <>
              <dt>Duration</dt>
              <dd>{formatDuration(job.startedAt, end)}</dd>
            </>
          )}
          {job.prUrl && (
            <>
              <dt>Pull request</dt>
              <dd>
                <a href={job.prUrl} target="_blank" rel="noreferrer">
                  {job.prUrl}
                </a>
              </dd>
            </>
          )}
        </dl>

        {job.error && (
          <section>
            <h4>Error</h4>
            <pre className="error-box">{job.error}</pre>
          </section>
        )}

        <section>
          <h4>Timeline</h4>
          <ol className="timeline">
            {job.timeline.map((entry, index) => (
              <li key={index} className={`timeline-${entry.event}`}>
                <span className="timeline-time">{formatTime(entry.at)}</span>
                <span className="timeline-event">{eventLabel(entry.event)}</span>
                {entry.note && <span className="muted"> · {entry.note}</span>}
              </li>
            ))}
          </ol>
        </section>

        {job.testPlan && (
          <section>
            <h4>Test plan</h4>
            <p className="mono">{job.testPlan.testFilePath}</p>
            <p>{job.testPlan.summary}</p>
            <ul className="plan">
              {job.testPlan.cases.map((testCase, index) => (
                <li key={index}>
                  <strong>{testCase.name}</strong>
                  {testCase.covers && <span className="muted"> — {testCase.covers}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
