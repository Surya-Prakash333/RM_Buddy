import { Injectable, Logger } from '@nestjs/common';
import { AlertDeliveryPayload, InAppNotification } from './alert.types';

/**
 * AlertTemplateService formats raw alert payloads into channel-specific
 * human-readable messages.
 *
 * Keeps all formatting logic in one place so channels (WebSocket, voice,
 * push) receive consistently worded notifications without duplicating logic
 * in the dispatcher.
 */
@Injectable()
export class AlertTemplateService {
  private readonly logger = new Logger(AlertTemplateService.name);

  /**
   * Format an alert payload for in-app delivery via WebSocket.
   *
   * Returns a structured notification object the frontend can render
   * directly without additional transformation.
   */
  formatInApp(alertPayload: AlertDeliveryPayload): InAppNotification {
    this.logger.debug(
      `Formatting in-app notification alert_id=${alertPayload.alert_id} ` +
        `rm_id=${alertPayload.rm_id}`,
    );

    return {
      alert_id: alertPayload.alert_id,
      title: alertPayload.title,
      message: alertPayload.message,
      severity: alertPayload.severity,
      alert_type: alertPayload.alert_type,
      client_name: alertPayload.client_name,
      action_suggestion: alertPayload.action_suggestion,
      created_at: alertPayload.created_at,
    };
  }

  /**
   * Format an alert payload for voice delivery via ElevenLabs.
   *
   * Produces a short, conversational sentence suitable for a phone call or
   * audio notification. Keeps the message under ~30 words to avoid fatigue.
   *
   * Example output:
   *   "Rajesh, you have a critical alert about your client Arun Sharma.
   *    Their funds have been idle for 30 days. Please review immediately."
   */
  formatVoice(alertPayload: AlertDeliveryPayload): string {
    const firstName = alertPayload.rm_name.split(' ')[0] ?? alertPayload.rm_name;
    const urgencyPhrase =
      alertPayload.severity === 'critical'
        ? 'Please review this immediately.'
        : 'Please review at your earliest convenience.';

    return (
      `${firstName}, you have an alert about your client ${alertPayload.client_name}. ` +
      `${alertPayload.message} ${urgencyPhrase}`
    );
  }

  /**
   * Format an alert payload for WhatsApp or push notification.
   *
   * Not yet implemented — Naman to integrate push provider.
   * Returns a plain-text fallback that can be used as a push body.
   */
  formatPush(alertPayload: AlertDeliveryPayload): string {
    // TODO: integrate push notification provider (FCM / WhatsApp Business API)
    return `[${alertPayload.severity.toUpperCase()}] ${alertPayload.title} — ${alertPayload.client_name}`;
  }
}
