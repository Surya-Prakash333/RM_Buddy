import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error', 'debug'],
  });

  // ---------------------------------------------------------------------------
  // CORS — allow all origins; tighten per-environment via CORS_ORIGINS env var
  // ---------------------------------------------------------------------------
  app.enableCors({
    origin: process.env['CORS_ORIGINS'] ?? '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ---------------------------------------------------------------------------
  // Health check endpoint — inline controller-free response via express adapter
  // ---------------------------------------------------------------------------
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/health', (_req: unknown, res: { json: (body: unknown) => void }) => {
    res.json({ status: 'ok', service: 'communication-service', ts: new Date().toISOString() });
  });

  // ---------------------------------------------------------------------------
  // Start HTTP server (WebSocket gateway shares the same port via Socket.IO)
  // ---------------------------------------------------------------------------
  const port = parseInt(process.env['PORT'] ?? '3003', 10);
  await app.listen(port);

  logger.log(`Communication service listening on http://0.0.0.0:${port}`);
  logger.log(`WebSocket /alerts namespace available on ws://0.0.0.0:${port}/alerts`);
}

bootstrap().catch((err: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    'Failed to start communication-service',
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
