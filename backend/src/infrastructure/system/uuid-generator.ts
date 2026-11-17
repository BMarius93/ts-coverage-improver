import { randomUUID } from 'node:crypto';
import { IdGenerator } from '../../domain/shared/id-generator';

export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
