import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import kafkaConfig from '../../config/kafka.config';
import { KafkaService, KAFKA_PRODUCER, KAFKA_CONSUMER } from './kafka.service';

/**
 * KafkaModule wires up KafkaJS producer and consumer clients and exposes
 * KafkaService for use by other feature modules.
 *
 * The producer and consumer are created via async factory providers so that:
 *  1. Configuration is resolved from the environment at startup.
 *  2. Both clients are fully injectable — tests can supply mock objects
 *     via the KAFKA_PRODUCER / KAFKA_CONSUMER tokens without needing
 *     kafkajs installed.
 *
 * kafkajs is required only inside the factory functions (not at the top of
 * this file) so the service file stays free of any direct kafkajs dependency.
 */
@Module({
  imports: [ConfigModule.forFeature(kafkaConfig)],
  providers: [
    {
      provide: KAFKA_PRODUCER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Kafka } = require('kafkajs') as typeof import('kafkajs');

        const brokers = configService.get<string[]>('kafka.brokers', ['localhost:9092']);
        const clientId = configService.get<string>('kafka.clientId', 'rm-buddy-core-api');
        const connectionTimeout = configService.get<number>('kafka.connectionTimeout', 10_000);
        const requestTimeout = configService.get<number>('kafka.requestTimeout', 30_000);

        const kafka = new Kafka({
          clientId,
          brokers,
          connectionTimeout,
          requestTimeout,
        });

        return kafka.producer();
      },
    },
    {
      provide: KAFKA_CONSUMER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Kafka } = require('kafkajs') as typeof import('kafkajs');

        const brokers = configService.get<string[]>('kafka.brokers', ['localhost:9092']);
        const clientId = configService.get<string>('kafka.clientId', 'rm-buddy-core-api');
        const groupId = configService.get<string>('kafka.groupId', 'core-api-group');
        const connectionTimeout = configService.get<number>('kafka.connectionTimeout', 10_000);
        const requestTimeout = configService.get<number>('kafka.requestTimeout', 30_000);

        const kafka = new Kafka({
          clientId,
          brokers,
          connectionTimeout,
          requestTimeout,
        });

        return kafka.consumer({ groupId });
      },
    },
    KafkaService,
  ],
  exports: [KafkaService],
})
export class KafkaModule {}
