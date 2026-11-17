import { jobLabel } from '../lib/format';
import type { Job } from '../lib/types';

export function JobBadge({ job, onClick }: { job: Job; onClick: () => void }) {
  return (
    <button type="button" className={`badge badge-${job.status}`} onClick={onClick} title="Show job details">
      {job.status === 'running' && <span className="spinner" aria-hidden />}
      {jobLabel(job)}
    </button>
  );
}
