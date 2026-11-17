/**
 * Base class for errors that express a broken business rule. The `code` is stable and is what
 * outer layers (e.g. the HTTP interface) map to status codes; messages are for humans.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A value did not satisfy the invariants of a value object or entity. */
export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
  }
}

/** An aggregate was asked to move to a state that its state machine does not allow. */
export class IllegalStateTransitionError extends DomainError {
  readonly code = 'ILLEGAL_STATE_TRANSITION';

  constructor(entity: string, from: string, action: string) {
    super(`${entity} cannot ${action} while ${from}`);
  }
}

/** A business rule about coexisting aggregates was violated (e.g. duplicate active job). */
export class ConflictError extends DomainError {
  readonly code = 'CONFLICT';

  constructor(message: string) {
    super(message);
  }
}

/** The aggregate was modified by someone else since it was loaded (optimistic concurrency). */
export class ConcurrencyConflictError extends DomainError {
  readonly code = 'CONCURRENCY_CONFLICT';

  constructor(entity: string, id: string) {
    super(`${entity} ${id} was modified concurrently`);
  }
}
