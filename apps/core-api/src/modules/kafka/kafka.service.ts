import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';

// ---------------------------------------------------------------------------
// Minimal interface contracts for the KafkaJS objects injected via DI.
//
// Defined locally (not imported from kafkajs) so this service is testable
// without the package being installed — same pattern used by CacheService
// for ioredis.  The real KafkaJS objects satisfy these interfaces at runtime.
// ---------------------------------------------------------------------------

export interface IKafkaProducer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(record: {
    topic: string;
    messages: Array<{ key: string; value: string }>;
  }): Promise<unknown>;
}

export interface IKafkaConsumer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(opts: { topic: string; fromBeginning: boolean }): Promise<void>;
  run(opts: {
    eachMessage: (payload: {
      topic: string;
      partition: number;
      message: {
        key: Buffer | null;
        value: Buffer | null;
        offset: string;
        timestamp: string;
      };
    }) => Promise<void>;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Injection tokens
// ---------------------------------------------------------------------------
export const KAFKA_PRODUCER = Symbol('KAFKA_PRODUCER');
export const KAFKA_CONSUMER = Symbol('KAFKA_CONSUMER');

// ---------------------------------------------------------------------------
// Public message shape returned to callers of subscribe()
// ---------------------------------------------------------------------------

/**
 * Normalised Kafka message as delivered to subscribe() handlers.
 * Values are already JSON-parsed by the time the handler receives them.
 */
export interface KafkaMessage {
  topic: string;
  key: string | null;
  value: unknown;
  offset: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * KafkaService provides a thin, opinionated wrapper around KafkaJS.
 *
 * Responsibilities:
 *  - JSON-serialize all outbound message values.
 *  - JSON-deserialize all inbound message values before calling the handler.
 *  - Connect / disconnect the producer on NestJS lifecycle hooks.
 *  - Structured error logging via NestJS Logger.
 *
 * The producer and consumer are injected via DI tokens so that unit tests
 * can supply mocks without needing kafkajs installed.
 */
@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);

  constructor(
    @Inject(KAFKA_PRODUCER) private readonly producer: IKafkaProducer,
    @Inject(KAFKA_CONSUMER) private readonly consumer: IKafkaConsumer,
  ) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async onModuleInit(): Promise<void> {
    try {
      await this.producer.connect();
      this.logger.log('Kafka producer connected');
    } catch (err) {
      // Non-fatal: app continues without Kafka (alerts won't be published but API remains up)
      this.logger.error(`Kafka producer connect failed: ${(err as Error).message}`);
      this.logger.warn('Running without Kafka — alert publishing disabled');
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.producer.disconnect();
      this.logger.log('Kafka producer disconnected');
    } catch (err) {
      this.logger.error(`Kafka producer disconnect failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  /**
   * Publish a message to a Kafka topic.
   *
   * @param topic  Target topic name (use constants from kafka.config.ts).
   * @param key    Routing key — should be the `rm_id` for partition affinity.
   * @param value  Any serialisable payload; JSON-serialised internally.
   */
  async publish(topic: string, key: string, value: unknown): Promise<void> {
    try {
      await this.producer.send({
        topic,
        messages: [{ key, value: JSON.stringify(value) }],
      });
      this.logger.debug(`Published to ${topic} [key=${key}]`);
    } catch (err) {
      this.logger.warn(
        `Kafka publish skipped (topic="${topic}" key=${key}): ${(err as Error).message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Subscribe
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to a topic and call `handler` for every incoming message.
   *
   * The raw KafkaJS Buffer values are JSON-parsed before being passed to the
   * handler.  If parsing fails the message is logged and skipped (dead-letter
   * handling is left to a future enhancement).
   *
   * @param topic    Topic to subscribe to.
   * @param handler  Async handler receiving a normalised KafkaMessage.
   */
  async subscribe(
    topic: string,
    handler: (message: KafkaMessage) => Promise<void>,
  ): Promise<void> {
    try {
      await this.consumer.connect();
      await this.consumer.subscribe({ topic, fromBeginning: false });

      await this.consumer.run({
        eachMessage: async ({ topic: msgTopic, message }) => {
          const keyStr = message.key ? message.key.toString() : null;
          const rawValue = message.value ? message.value.toString() : null;

          let parsedValue: unknown = null;
          if (rawValue !== null) {
            try {
              parsedValue = JSON.parse(rawValue);
            } catch (parseErr) {
              this.logger.warn(
                `Failed to parse message value on topic "${msgTopic}" [key=${keyStr}]: ${(parseErr as Error).message}`,
              );
            }
          }

          const normalised: KafkaMessage = {
            topic: msgTopic,
            key: keyStr,
            value: parsedValue,
            offset: message.offset,
            timestamp: message.timestamp,
          };

          await handler(normalised);
        },
      });

      this.logger.log(`Subscribed to Kafka topic: ${topic}`);
    } catch (err) {
      this.logger.error(
        `Failed to subscribe to topic "${topic}": ${(err as Error).message}`,
      );
      throw err;
    }
  }
}
