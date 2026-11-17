import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { WorkerAppModule } from './worker.module';

async function bootstrap(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const app = await NestFactory.createApplicationContext(WorkerAppModule);
  app.enableShutdownHooks();
}

void bootstrap();
