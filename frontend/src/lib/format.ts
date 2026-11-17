import type { FileRow, Job, JobPhase, Repository } from './types';

export const PHASES: JobPhase[] = ['cloning', 'planning', 'writing', 'verifying', 'fixing', 'opening_pr'];

const PHASE_LABELS: Record<JobPhase, string> = {
  cloning: 'Cloning',
  planning: 'Planning',
  writing: 'Writing tests',
  verifying: 'Verifying',
  fixing: 'Fixing',
  opening_pr: 'Opening PR',
};

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

export type CoverageLevel = 'low' | 'medium' | 'good';

/** Red below half the threshold, amber below the threshold, green at or above it. */
export function coverageLevel(value: number, threshold: number): CoverageLevel {
  if (value >= threshold) return 'good';
  if (value >= threshold / 2) return 'medium';
  return 'low';
}

export function isJobActive(job: Job | null | undefined): boolean {
  return job?.status === 'queued' || job?.status === 'running';
}

/** Short human label for a job, e.g. "Running · Writing tests" or "Failed during verifying". */
export function jobLabel(job: Job): string {
  switch (job.status) {
    case 'queued':
      return job.attempts > 0 ? `Queued (retry ${job.attempts + 1})` : 'Queued';
    case 'running':
      return `Running · ${job.phase ? PHASE_LABELS[job.phase] : '…'}`;
    case 'completed':
      return 'PR opened';
    case 'failed':
      return job.phase ? `Failed · ${PHASE_LABELS[job.phase]}` : 'Failed';
  }
}

export function eventLabel(event: string): string {
  return event in PHASE_LABELS
    ? PHASE_LABELS[event as JobPhase]
    : event.charAt(0).toUpperCase() + event.slice(1);
}

/** Poll fast while something is in progress, slowly otherwise (to pick up changes made elsewhere). */
export function pollInterval(repositories: Repository[], files: FileRow[], openJob: Job | null): number {
  const busy =
    repositories.some((repo) => repo.scanStatus === 'scanning') ||
    files.some((file) => isJobActive(file.latestJob)) ||
    isJobActive(openJob);
  return busy ? 2500 : 15000;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDuration(fromIso: string, toIso: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
