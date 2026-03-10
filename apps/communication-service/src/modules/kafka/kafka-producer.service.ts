import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Minimal interface for the KafkaJS Producer client.
// Defined locally so this service is testable without kafkajs installed.
// ---------------------------------------------------------------------------
export interface IKafkaProducer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(record: {
    topic: string;
    messages: Array<{ key?: string; value: string }>;
  }): Promise<void>;
}

export const KAFKA_PRODUCER = Symbol('KAFKA_PRODUCER');

/**
 * KafkaProducerService wraps the KafkaJS producer.
 *
 * Exposes a single `publish` method used by AlertDispatcherService to emit
 * alerts.delivered confirmations after each dispatch cycle.
 *
 * Connection lifecycle is managed here (onModuleInit / onModuleDestroy) so
 * that callers need not handle connect/disconnect themselves.
 */
@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private connected = false;

  constructor(@Inject(KAFKA_PRODUCER) private readonly producer: IKafkaProducer) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.producer.connect();
      this.connected = true;
      this.logger.log('Kafka producer connected');
    } catch (err) {
      this.logger.error(
        `Kafka producer connect failed: ${(err as Error).message}. ` +
          'Delivery confirmations will be skipped until reconnect.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.producer.disconnect();
      this.logger.log('Kafka producer disconnected');
    } catch (err) {
      this.logger.warn(`Kafka producer disconnect error: ${(err as Error).message}`);
    }
  }

  /**
   * Publish a message to a Kafka topic.
   *
   * @param topic   Target Kafka topic name.
   * @param key     Message key (used for partition routing).
   * @param payload Object to be JSON-serialised as the message value.
   */
  async publish(topic: string, key: string, payload: unknown): Promise<void> {
    if (!this.connected) {
      this.logger.warn(
        `Kafka producer not connected — skipping publish to topic=${topic} key=${key}`,
      );
      return;
    }

    try {
      await this.producer.send({
        topic,
        messages: [{ key, value: JSON.stringify(payload) }],
      });
      this.logger.debug(`Published to topic=${topic} key=${key}`);
    } catch (err) {
      this.logger.error(
        `Failed to publish to topic=${topic} key=${key}: ${(err as Error).message}`,
      );
    }
  }
}
