import { Module } from '@nestjs/common';
import { ConfigModule } from './composition/config.module';
import { WorkerModule } from './composition/worker.module';

/** The worker-only process (no HTTP). */
@Module({
  imports: [ConfigModule, WorkerModule.register({ enabled: true })],
})
export class WorkerAppModule {}
