import { Module, forwardRef } from '@nestjs/common';
import { AlertDispatcherService } from './alert-dispatcher.service';
import { AlertTemplateService } from './alert-template.service';
import { AlertsWebSocketGateway } from './websocket.gateway';
import { VoiceService } from './voice.service';
import { KafkaModule } from '../kafka/kafka.module';

/**
 * AlertsModule wires all alert dispatch dependencies:
 *
 *  - AlertsWebSocketGateway  — Socket.IO /alerts namespace
 *  - AlertTemplateService    — channel-specific message formatting
 *  - VoiceService            — ElevenLabs outbound calls
 *  - AlertDispatcherService  — orchestrates the above
 *
 * KafkaModule is imported (via forwardRef to break the mutual dependency)
 * so AlertDispatcherService can publish to `alerts.delivered`.
 *
 * AlertDispatcherService is exported so KafkaConsumerService (inside
 * KafkaModule) can inject it via the forwardRef pattern.
 */
@Module({
  imports: [
    // forwardRef breaks the circular dependency:
    // AlertsModule → KafkaModule → (consumer needs) AlertDispatcherService → AlertsModule
    forwardRef(() => KafkaModule),
  ],
  providers: [
    AlertsWebSocketGateway,
    AlertTemplateService,
    VoiceService,
    AlertDispatcherService,
  ],
  exports: [AlertDispatcherService],
})
export class AlertsModule {}
