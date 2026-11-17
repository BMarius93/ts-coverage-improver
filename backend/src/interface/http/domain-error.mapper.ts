import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DomainError } from '../../domain/shared/domain-error';
import { Result } from '../../domain/shared/result';

/** Translates domain/application error codes into HTTP status codes. */
export function toHttpException(error: DomainError): HttpException {
  const body = { code: error.code, message: error.message };
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return new BadRequestException(body);
    case 'NOT_FOUND':
      return new NotFoundException(body);
    case 'CONFLICT':
    case 'NOT_AN_IMPROVEMENT_CANDIDATE':
    case 'ILLEGAL_STATE_TRANSITION':
    case 'CONCURRENCY_CONFLICT':
      return new ConflictException(body);
    default:
      return new InternalServerErrorException(body);
  }
}

/** Returns the value of a successful use case result or throws the matching HTTP exception. */
export function unwrapOrThrow<T>(result: Result<T, DomainError>): T {
  if (result.ok) {
    return result.value;
  }
  throw toHttpException(result.error);
}
