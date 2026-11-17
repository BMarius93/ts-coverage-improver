export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_PHASES = ['cloning', 'planning', 'writing', 'verifying', 'fixing', 'opening_pr'] as const;
export type JobPhase = (typeof JOB_PHASES)[number];

/**
 * Allowed phase transitions while a job is running. `cloning -> writing` is the single-call AI mode
 * (no separate planning step); `verifying <-> fixing` is the fix loop.
 */
const NEXT_PHASES: Readonly<Record<JobPhase, readonly JobPhase[]>> = {
  cloning: ['planning', 'writing'],
  planning: ['writing'],
  writing: ['verifying'],
  verifying: ['fixing', 'opening_pr'],
  fixing: ['verifying'],
  opening_pr: [],
};

export function canAdvance(from: JobPhase, to: JobPhase): boolean {
  return NEXT_PHASES[from].includes(to);
}

export function isJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

export function isJobPhase(value: string): value is JobPhase {
  return (JOB_PHASES as readonly string[]).includes(value);
}
