import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppValidationPipe } from './common/pipes/validation.pipe';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // ---------------------------------------------------------------------------
  // CORS — allow all origins in dev; tighten in production via env
  // ---------------------------------------------------------------------------
  app.enableCors({
    origin: process.env['CORS_ORIGINS'] ?? '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-RM-Identity'],
  });

  // ---------------------------------------------------------------------------
  // Global validation pipe
  // ---------------------------------------------------------------------------
  app.useGlobalPipes(AppValidationPipe);

  // ---------------------------------------------------------------------------
  // Global logging interceptor
  // ---------------------------------------------------------------------------
  app.useGlobalInterceptors(new LoggingInterceptor());

  // ---------------------------------------------------------------------------
  // Swagger — available at /api/docs
  // ---------------------------------------------------------------------------
  const swaggerConfig = new DocumentBuilder()
    .setTitle('RM Buddy Core API')
    .setDescription(
      'REST API for the Nuvama Wealth Management RM Buddy platform. ' +
      'All business endpoints require the X-RM-Identity header.',
    )
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-RM-Identity' }, 'X-RM-Identity')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // ---------------------------------------------------------------------------
  // Start listening
  // ---------------------------------------------------------------------------
  const port = parseInt(process.env['PORT'] ?? '3001', 10);
  await app.listen(port);
  logger.log(`Core API listening on http://0.0.0.0:${port}`);
  logger.log(`Swagger docs at http://0.0.0.0:${port}/api/docs`);
}

bootstrap().catch((err: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start core-api', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
