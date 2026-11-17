import { Module } from '@nestjs/common';
import { ConfigModule } from './composition/config.module';
import { HttpModule } from './composition/http.module';
import { WorkerModule } from './composition/worker.module';

/** The API process; also runs the worker when RUN_WORKER=true. */
@Module({
  imports: [ConfigModule, HttpModule, WorkerModule.register()],
})
export class AppModule {}
