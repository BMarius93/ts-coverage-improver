import { BadRequestException } from '@nestjs/common';
import { NotFoundError } from '../../src/application/errors';
import {
  ConcurrencyConflictError,
  ConflictError,
  DomainError,
  ValidationError,
} from '../../src/domain/shared/domain-error';
import { err, ok } from '../../src/domain/shared/result';
import { toHttpException, unwrapOrThrow } from '../../src/interface/http/domain-error.mapper';

class OddError extends DomainError {
  readonly code = 'ODD';
  constructor() {
    super('odd');
  }
}

describe('domain error mapping', () => {
  it.each([
    [new ValidationError('x'), 400],
    [new NotFoundError('Job', '1'), 404],
    [new ConflictError('x'), 409],
    [new ConcurrencyConflictError('Job', '1'), 409],
    [new OddError(), 500],
  ])('%p -> %p', (error, status) => {
    const exception = toHttpException(error);
    expect(exception.getStatus()).toBe(status);
    expect(exception.getResponse()).toEqual({ code: error.code, message: error.message });
  });

  it('unwraps results', () => {
    expect(unwrapOrThrow(ok(1))).toBe(1);
    expect(() => unwrapOrThrow(err(new ValidationError('bad')))).toThrow(BadRequestException);
  });
});
