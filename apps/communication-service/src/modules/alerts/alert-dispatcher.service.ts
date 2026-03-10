import { Injectable, Logger } from '@nestjs/common';
import { AlertDeliveryPayload } from './alert.types';
import { AlertTemplateService } from './alert-template.service';
import { AlertsWebSocketGateway } from './websocket.gateway';
import { VoiceService } from './voice.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';

/**
 * AlertDispatcherService is the central dispatch coordinator for the
 * Communication Service.
 *
 * For each incoming AlertDeliveryPayload it iterates the requested channels
 * and delegates to the appropriate delivery mechanism:
 *
 *  - IN_APP  → WebSocket emit via AlertsWebSocketGateway
 *  - VOICE   → ElevenLabs call via VoiceService (HIGH / CRITICAL only)
 *
 * After all delivery attempts it publishes an `alerts.delivered` confirmation
 * to Kafka so Core API and audit systems can track delivery state.
 *
 * Error handling philosophy:
 *  - Per-channel failures are caught and logged; they do NOT abort remaining
 *    channels or the Kafka publish.
 *  - The Kafka publish itself is best-effort (KafkaProducerService swallows
 *    its own errors).
 */
@Injectable()
export class AlertDispatcherService {
  private readonly logger = new Logger(AlertDispatcherService.name);

  /** Severities that qualify for outbound voice calls */
  private static readonly VOICE_SEVERITIES = new Set<string>(['critical', 'high']);

  constructor(
    private readonly wsGateway: AlertsWebSocketGateway,
    private readonly templateService: AlertTemplateService,
    private readonly voiceService: VoiceService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  /**
   * Dispatch an alert to all requested channels and emit a delivery receipt.
   *
   * @param payload  The alert payload consumed from `alerts.generated`.
   */
  async dispatch(payload: AlertDeliveryPayload): Promise<void> {
    const deliveredChannels: string[] = [];

    for (const channel of payload.channels ?? []) {
      try {
        switch (channel) {
          case 'IN_APP': {
            const notification = this.templateService.formatInApp(payload);
            this.wsGateway.sendToRM(payload.rm_id, 'new_alert', notification);
            deliveredChannels.push('IN_APP');
            this.logger.log(
              `IN_APP alert delivered alert_id=${payload.alert_id} rm_id=${payload.rm_id}`,
            );
            break;
          }

          case 'VOICE': {
            if (AlertDispatcherService.VOICE_SEVERITIES.has(payload.severity)) {
              await this.voiceService.initiateCall(payload.rm_id, {
                rm_name: payload.rm_name,
                client_name: payload.client_name,
                alert_message: this.templateService.formatVoice(payload),
              });
              deliveredChannels.push('VOICE');
              this.logger.log(
                `VOICE call initiated alert_id=${payload.alert_id} rm_id=${payload.rm_id}`,
              );
            } else {
              this.logger.debug(
                `VOICE skipped (severity=${payload.severity} < high) ` +
                  `alert_id=${payload.alert_id}`,
              );
            }
            break;
          }

          default: {
            // Exhaustive guard: log unknown channels without crashing
            this.logger.warn(
              `Unknown delivery channel=${String(channel)} alert_id=${payload.alert_id}`,
            );
          }
        }
      } catch (err) {
        this.logger.error(
          `Channel=${channel} delivery failed for alert_id=${payload.alert_id}: ` +
            `${(err as Error).message}`,
        );
      }
    }

    // Publish delivery receipt — best-effort, non-blocking on failure
    await this.kafkaProducer.publish('alerts.delivered', payload.alert_id, {
      alert_id: payload.alert_id,
      delivered_channels: deliveredChannels,
      delivered_at: new Date().toISOString(),
    });
  }
}
