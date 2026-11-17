import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './infrastructure/config/app-config';

async function bootstrap(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);
  app.enableCors({ origin: config.CORS_ORIGIN });
  app.enableShutdownHooks();
  await app.listen(config.PORT);
}

void bootstrap();
