import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KafkaModule } from './modules/kafka/kafka.module';
import { AlertsModule } from './modules/alerts/alerts.module';

/**
 * Root application module for the Communication Service.
 *
 * Responsibilities:
 *  - ConfigModule (global) — provides env vars to all child modules
 *  - KafkaModule — consumer for alerts.generated + producer for alerts.delivered
 *  - AlertsModule — dispatching via WebSocket (in-app) and ElevenLabs (voice)
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env.comm',
      ignoreEnvFile: process.env['NODE_ENV'] === 'production',
    }),
    KafkaModule,
    AlertsModule,
  ],
})
export class AppModule {}
