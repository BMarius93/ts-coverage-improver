import { Module } from '@nestjs/common';
import { HealthController } from '../interface/http/health.controller';
import { JobsController } from '../interface/http/jobs.controller';
import { RepositoriesController } from '../interface/http/repositories.controller';
import { ApplicationModule } from './application.module';

@Module({
  imports: [ApplicationModule],
  controllers: [HealthController, RepositoriesController, JobsController],
})
export class HttpModule {}
