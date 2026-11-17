import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { JOB_QUEUE_PORT } from '../application/ports/job-queue.port';
import {
  CLOCK,
  ID_GENERATOR,
  IMPROVEMENT_JOB_REPOSITORY,
  REPOSITORY_REPOSITORY,
} from '../application/tokens';
import { Clock } from '../domain/shared/clock';
import { APP_CONFIG, AppConfig } from '../infrastructure/config/app-config';
import { openDatabase, SqliteDatabase } from '../infrastructure/persistence/sqlite/sqlite-database';
import { SqliteImprovementJobRepository } from '../infrastructure/persistence/sqlite/sqlite-improvement-job-repository';
import { SqliteJobQueue } from '../infrastructure/persistence/sqlite/sqlite-job-queue';
import { SqliteRepositoryRepository } from '../infrastructure/persistence/sqlite/sqlite-repository-repository';
import { SystemClock } from '../infrastructure/system/system-clock';
import { UuidGenerator } from '../infrastructure/system/uuid-generator';

export const SQLITE_DATABASE = Symbol('SqliteDatabase');

@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidGenerator },
    {
      provide: SQLITE_DATABASE,
      useFactory: (config: AppConfig) => openDatabase(config.databasePath),
      inject: [APP_CONFIG],
    },
    {
      provide: REPOSITORY_REPOSITORY,
      useFactory: (db: SqliteDatabase) => new SqliteRepositoryRepository(db),
      inject: [SQLITE_DATABASE],
    },
    {
      provide: IMPROVEMENT_JOB_REPOSITORY,
      useFactory: (db: SqliteDatabase) => new SqliteImprovementJobRepository(db),
      inject: [SQLITE_DATABASE],
    },
    {
      provide: JOB_QUEUE_PORT,
      useFactory: (db: SqliteDatabase, clock: Clock) => new SqliteJobQueue(db, clock),
      inject: [SQLITE_DATABASE, CLOCK],
    },
  ],
  exports: [
    CLOCK,
    ID_GENERATOR,
    SQLITE_DATABASE,
    REPOSITORY_REPOSITORY,
    IMPROVEMENT_JOB_REPOSITORY,
    JOB_QUEUE_PORT,
  ],
})
export class PersistenceModule implements OnApplicationShutdown {
  constructor(@Inject(SQLITE_DATABASE) private readonly db: SqliteDatabase) {}

  onApplicationShutdown(): void {
    if (this.db.open) this.db.close();
  }
}
