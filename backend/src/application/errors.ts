import { DomainError } from '../domain/shared/domain-error';

/** A referenced aggregate does not exist. */
export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';

  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`);
  }
}

/** The worker's lease on a job was lost; another worker may own it now. */
export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Lease on job ${jobId} was lost`);
    this.name = 'LeaseLostError';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
