import { Module } from '@nestjs/common';
import { HealthController } from '../interface/http/health.controller';
import { RepositoriesController } from '../interface/http/repositories.controller';
import { ApplicationModule } from './application.module';

@Module({
  imports: [ApplicationModule],
  controllers: [HealthController, RepositoriesController],
})
export class HttpModule {}
