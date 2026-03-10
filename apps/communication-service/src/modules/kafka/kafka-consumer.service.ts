import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  forwardRef,
} from '@nestjs/common';
import { AlertDispatcherService } from '../alerts/alert-dispatcher.service';
import { AlertDeliveryPayload } from '../alerts/alert.types';

// ---------------------------------------------------------------------------
// Minimal interface for the KafkaJS Consumer client.
// Defined locally so this service is testable without kafkajs installed.
// ---------------------------------------------------------------------------
export interface IKafkaConsumer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(options: { topic: string; fromBeginning?: boolean }): Promise<void>;
  run(config: {
    eachMessage: (payload: {
      topic: string;
      partition: number;
      message: { value: Buffer | null; key: Buffer | null };
    }) => Promise<void>;
  }): Promise<void>;
}

export const KAFKA_CONSUMER = Symbol('KAFKA_CONSUMER');

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);

  constructor(
    @Inject(KAFKA_CONSUMER) private readonly consumer: IKafkaConsumer,
    // forwardRef resolves circular: AlertsModule imports KafkaModule, KafkaModule
    // needs AlertDispatcherService → use forwardRef to break the cycle.
    @Inject(forwardRef(() => AlertDispatcherService))
    private readonly alertDispatcher: AlertDispatcherService,
  ) {}

  /**
   * On startup: connect to Kafka, subscribe to relevant topics, and start
   * the consumer loop. All errors are caught and logged — never propagated
   * to avoid crashing the process on transient Kafka unavailability.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.consumer.connect();
      this.logger.log('Kafka consumer connected');

      await this.consumer.subscribe({ topic: 'alerts.generated', fromBeginning: false });
      await this.consumer.subscribe({ topic: 'alerts.delivered', fromBeginning: false });

      this.logger.log('Subscribed to topics: alerts.generated, alerts.delivered');

      await this.consumer.run({
        eachMessage: async ({ topic, message }) => {
          try {
            if (topic === 'alerts.generated') {
              await this.handleAlertGenerated(message);
            } else if (topic === 'alerts.delivered') {
              this.handleAlertDelivered(message);
            }
          } catch (err) {
            this.logger.error(
              `Unhandled error in eachMessage handler topic=${topic}: ${(err as Error).message}`,
            );
          }
        },
      });
    } catch (err) {
      this.logger.error(
        `Kafka consumer init failed: ${(err as Error).message}. ` +
          'Service will start without Kafka connectivity.',
      );
    }
  }

  /**
   * On shutdown: disconnect the consumer gracefully so Kafka reassigns
   * partitions to other group members without waiting for a session timeout.
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.consumer.disconnect();
      this.logger.log('Kafka consumer disconnected');
    } catch (err) {
      this.logger.warn(`Kafka consumer disconnect error: ${(err as Error).message}`);
    }
  }

  /**
   * Parse and dispatch an alerts.generated message.
   * Parse errors are logged and the message is skipped (not re-queued).
   */
  private async handleAlertGenerated(message: {
    value: Buffer | null;
    key: Buffer | null;
  }): Promise<void> {
    if (!message.value) {
      this.logger.warn('Received alerts.generated message with null value — skipping');
      return;
    }

    let payload: AlertDeliveryPayload;
    try {
      payload = JSON.parse(message.value.toString()) as AlertDeliveryPayload;
    } catch (err) {
      this.logger.error(
        `Failed to parse alerts.generated message: ${(err as Error).message}. Raw value skipped.`,
      );
      return;
    }

    this.logger.log(
      `Dispatching alert alert_id=${payload.alert_id} rm_id=${payload.rm_id} ` +
        `channels=${payload.channels?.join(',')}`,
    );

    try {
      await this.alertDispatcher.dispatch(payload);
    } catch (err) {
      this.logger.error(
        `AlertDispatcherService.dispatch failed for alert_id=${payload.alert_id}: ` +
          `${(err as Error).message}`,
      );
    }
  }

  /**
   * Handle alerts.delivered acknowledgment — currently logged for audit trail.
   * Extend here when persistence of delivery receipts is required.
   */
  private handleAlertDelivered(message: { value: Buffer | null }): void {
    if (!message.value) return;

    try {
      const ack = JSON.parse(message.value.toString()) as {
        alert_id: string;
        delivered_channels: string[];
        delivered_at: string;
      };
      this.logger.log(
        `Delivery ack received alert_id=${ack.alert_id} ` +
          `channels=${ack.delivered_channels?.join(',')} delivered_at=${ack.delivered_at}`,
      );
    } catch (err) {
      this.logger.warn(`Failed to parse alerts.delivered message: ${(err as Error).message}`);
    }
  }
}
