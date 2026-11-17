import {
  ConcurrencyConflictError,
  ConflictError,
  IllegalStateTransitionError,
  ValidationError,
} from '../../../src/domain/shared/domain-error';
import { err, ok, unwrap } from '../../../src/domain/shared/result';

describe('Result', () => {
  it('unwraps an ok value', () => {
    expect(unwrap(ok(42))).toBe(42);
  });

  it('throws the error when unwrapping an err', () => {
    const error = new ValidationError('nope');
    expect(() => unwrap(err(error))).toThrow(error);
  });

  it('gives domain errors a stable code and their class name', () => {
    const error = new ValidationError('bad');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.name).toBe('ValidationError');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('domain errors', () => {
  it('exposes stable codes', () => {
    expect(new ConflictError('dup').code).toBe('CONFLICT');
    expect(new ConcurrencyConflictError('Job', 'j1').message).toBe('Job j1 was modified concurrently');
    expect(new IllegalStateTransitionError('Job', 'queued', 'complete').message).toBe(
      'Job cannot complete while queued',
    );
  });
});
