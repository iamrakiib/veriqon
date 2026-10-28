import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import dotenv from 'dotenv';
import type { Request, Response, NextFunction } from 'express';
import { validateEnvironment } from './common/config';

dotenv.config();

async function bootstrap() {
  validateEnvironment();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.disable('x-powered-by');
  // Configure only the hop count of the reverse proxy that actually fronts this deployment.
  if (process.env.TRUST_PROXY_HOPS) {
    const hops = Number(process.env.TRUST_PROXY_HOPS);
    if (!Number.isInteger(hops) || hops < 1 || hops > 3) throw new Error('TRUST_PROXY_HOPS must be 1, 2, or 3.');
    app.set('trust proxy', hops);
  }
  app.use((_request: Request, response: Response, next: NextFunction) => { response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
  app.useBodyParser('json', { limit: '750kb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  const port = process.env.PORT || 3000;
  await app.listen(port, process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'));
  console.log(`Server listening on http://localhost:${port}`);
}

bootstrap().catch(() => { console.error('API startup failed. Verify database migrations, Redis connectivity, and required environment settings.'); process.exit(1); });
 
