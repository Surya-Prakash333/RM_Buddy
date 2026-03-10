import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

/**
 * Bootstrap the auth-service NestJS application.
 *
 * Port resolution order:
 *  1. PORT environment variable
 *  2. Default: 3002
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // ---------------------------------------------------------------------------
  // CORS — allow all origins in development; tighten via env in production
  // ---------------------------------------------------------------------------
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Id'],
    credentials: false,
  });

  // ---------------------------------------------------------------------------
  // Global validation pipe — strips unknown fields, auto-transforms types
  // ---------------------------------------------------------------------------
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ---------------------------------------------------------------------------
  // Swagger — available at /api/docs (disabled in production)
  // ---------------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('RM Buddy — Auth Service')
      .setDescription(
        'SSO token validation and session management for Nuvama Wealth Management RMs',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('Swagger available at /api/docs');
  }

  // ---------------------------------------------------------------------------
  // Start listening
  // ---------------------------------------------------------------------------
  const port = parseInt(process.env.PORT || '3002', 10);
  await app.listen(port);
  logger.log(`Auth service running on port ${port}`);
}

bootstrap().catch((err: Error) => {
  new Logger('Bootstrap').error(`Fatal startup error: ${err.message}`, err.stack);
  process.exit(1);
});
