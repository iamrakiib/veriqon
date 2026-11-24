import 'reflect-metadata';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { validateEnvironment } from './common/config';
import { backgroundConfig } from './common/background-config';

dotenv.config();
process.env.VERIQON_PROCESS_ROLE = 'worker';

async function bootstrap() {
  validateEnvironment(); backgroundConfig();
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  console.log(JSON.stringify({ event: 'worker_ready', transport: 'bullmq', httpListener: false }));
}
bootstrap().catch(() => {
  console.error('Worker startup failed. Verify database migrations and durable queue settings.');
  process.exit(1);
});
