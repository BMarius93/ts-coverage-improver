import { Module } from '@nestjs/common';
import { ConfigModule } from './composition/config.module';
import { HttpModule } from './composition/http.module';

/** The API process. */
@Module({
  imports: [ConfigModule, HttpModule],
})
export class AppModule {}
