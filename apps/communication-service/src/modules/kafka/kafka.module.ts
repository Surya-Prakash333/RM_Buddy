import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaConsumerService, KAFKA_CONSUMER } from './kafka-consumer.service';
import { KafkaProducerService, KAFKA_PRODUCER } from './kafka-producer.service';

/**
 * KafkaModule wires KafkaJS consumer and producer for the Communication Service.
 *
 * Both clients are instantiated inside factory providers (useFactory) so that
 * KafkaConsumerService and KafkaProducerService never import kafkajs directly.
 * This keeps both services fully testable without kafkajs installed.
 *
 * Consumer group: comm-service-group
 * Producer: used to publish alerts.delivered confirmations.
 */
@Module({
  providers: [
    // -------------------------------------------------------------------------
    // Kafka consumer client — injected via Symbol token
    // -------------------------------------------------------------------------
    {
      provide: KAFKA_CONSUMER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // require() inside factory keeps KafkaConsumerService testable
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Kafka } = require('kafkajs') as typeof import('kafkajs');

        const brokersEnv = configService.get<string>('KAFKA_BROKERS', 'localhost:9092');
        const brokers = brokersEnv.split(',').map((b) => b.trim());
        const groupId = configService.get<string>('KAFKA_GROUP_ID', 'comm-service-group');

        const kafka = new Kafka({
          clientId: 'rm-comm-consumer',
          brokers,
        });

        return kafka.consumer({ groupId });
      },
    },
    // -------------------------------------------------------------------------
    // Kafka producer client — injected via Symbol token
    // -------------------------------------------------------------------------
    {
      provide: KAFKA_PRODUCER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Kafka } = require('kafkajs') as typeof import('kafkajs');

        const brokersEnv = configService.get<string>('KAFKA_BROKERS', 'localhost:9092');
        const brokers = brokersEnv.split(',').map((b) => b.trim());

        const kafka = new Kafka({
          clientId: 'rm-comm-producer',
          brokers,
        });

        return kafka.producer();
      },
    },
    KafkaConsumerService,
    KafkaProducerService,
  ],
  exports: [KafkaConsumerService, KafkaProducerService],
})
export class KafkaModule {}
