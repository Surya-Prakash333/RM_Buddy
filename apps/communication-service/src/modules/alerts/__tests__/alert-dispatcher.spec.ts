import { Test, TestingModule } from '@nestjs/testing';
import { AlertDispatcherService } from '../alert-dispatcher.service';
import { AlertTemplateService } from '../alert-template.service';
import { AlertsWebSocketGateway } from '../websocket.gateway';
import { VoiceService } from '../voice.service';
import { KafkaProducerService } from '../../kafka/kafka-producer.service';
import { AlertDeliveryPayload, InAppNotification } from '../alert.types';

// ---------------------------------------------------------------------------
// Shared test fixture
// ---------------------------------------------------------------------------

const basePayload: AlertDeliveryPayload = {
  alert_id: 'ALERT-001',
  alert_type: 'IDLE_CASH',
  rm_id: 'RM001',
  rm_name: 'Rajesh Kumar',
  client_id: 'CLI-001',
  client_name: 'Arun Sharma',
  client_tier: 'PLATINUM',
  severity: 'high',
  title: 'Idle Cash Alert',
  message: 'Client Arun Sharma has cash idle for more than 30 days.',
  action_suggestion: 'Consider recommending liquid funds.',
  channels: ['IN_APP'],
  data: { idle_amount: 5000000 },
  created_at: '2026-03-10T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Mocks — typed to satisfy interfaces without installing real packages
// ---------------------------------------------------------------------------

const mockWsGateway = {
  sendToRM: jest.fn(),
};

const mockVoiceService = {
  initiateCall: jest.fn().mockResolvedValue(undefined),
};

const mockKafkaProducer = {
  publish: jest.fn().mockResolvedValue(undefined),
};

// AlertTemplateService is used with real logic for formatInApp / formatVoice tests
// but we can also use a real instance since it has no external dependencies.

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AlertDispatcherService', () => {
  let dispatcher: AlertDispatcherService;
  let templateService: AlertTemplateService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertDispatcherService,
        AlertTemplateService,
        { provide: AlertsWebSocketGateway, useValue: mockWsGateway },
        { provide: VoiceService, useValue: mockVoiceService },
        { provide: KafkaProducerService, useValue: mockKafkaProducer },
      ],
    }).compile();

    dispatcher = module.get<AlertDispatcherService>(AlertDispatcherService);
    templateService = module.get<AlertTemplateService>(AlertTemplateService);
  });

  // -------------------------------------------------------------------------
  // IN_APP channel
  // -------------------------------------------------------------------------

  describe('dispatch() with IN_APP channel', () => {
    it('should call wsGateway.sendToRM with new_alert event and formatted payload', async () => {
      const payload: AlertDeliveryPayload = { ...basePayload, channels: ['IN_APP'] };

      await dispatcher.dispatch(payload);

      expect(mockWsGateway.sendToRM).toHaveBeenCalledTimes(1);
      expect(mockWsGateway.sendToRM).toHaveBeenCalledWith(
        'RM001',
        'new_alert',
        expect.objectContaining<Partial<InAppNotification>>({
          alert_id: 'ALERT-001',
          title: 'Idle Cash Alert',
          client_name: 'Arun Sharma',
          severity: 'high',
        }),
      );
    });

    it('should NOT call voiceService.initiateCall when only IN_APP is requested', async () => {
      const payload: AlertDeliveryPayload = { ...basePayload, channels: ['IN_APP'] };

      await dispatcher.dispatch(payload);

      expect(mockVoiceService.initiateCall).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // VOICE channel — HIGH / CRITICAL severity
  // -------------------------------------------------------------------------

  describe('dispatch() with VOICE channel and HIGH severity', () => {
    it('should call voiceService.initiateCall with rm_name, client_name, alert_message', async () => {
      const payload: AlertDeliveryPayload = {
        ...basePayload,
        channels: ['VOICE'],
        severity: 'high',
      };

      await dispatcher.dispatch(payload);

      expect(mockVoiceService.initiateCall).toHaveBeenCalledTimes(1);
      expect(mockVoiceService.initiateCall).toHaveBeenCalledWith('RM001', {
        rm_name: 'Rajesh Kumar',
        client_name: 'Arun Sharma',
        alert_message: expect.stringContaining('Arun Sharma') as string,
      });
    });

    it('should call voiceService.initiateCall for CRITICAL severity', async () => {
      const payload: AlertDeliveryPayload = {
        ...basePayload,
        channels: ['VOICE'],
        severity: 'critical',
      };

      await dispatcher.dispatch(payload);

      expect(mockVoiceService.initiateCall).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // VOICE channel — LOW / MEDIUM severity (should be skipped)
  // -------------------------------------------------------------------------

  describe('dispatch() with VOICE channel and LOW severity', () => {
    it('should NOT call voiceService.initiateCall for LOW severity', async () => {
      const payload: AlertDeliveryPayload = {
        ...basePayload,
        channels: ['VOICE'],
        severity: 'low',
      };

      await dispatcher.dispatch(payload);

      expect(mockVoiceService.initiateCall).not.toHaveBeenCalled();
    });

    it('should NOT call voiceService.initiateCall for MEDIUM severity', async () => {
      const payload: AlertDeliveryPayload = {
        ...basePayload,
        channels: ['VOICE'],
        severity: 'medium',
      };

      await dispatcher.dispatch(payload);

      expect(mockVoiceService.initiateCall).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Kafka delivery confirmation
  // -------------------------------------------------------------------------

  describe('dispatch() Kafka delivery confirmation', () => {
    it('should publish to alerts.delivered with delivered channels after IN_APP dispatch', async () => {
      const payload: AlertDeliveryPayload = { ...basePayload, channels: ['IN_APP'] };

      await dispatcher.dispatch(payload);

      expect(mockKafkaProducer.publish).toHaveBeenCalledTimes(1);
      expect(mockKafkaProducer.publish).toHaveBeenCalledWith(
        'alerts.delivered',
        'ALERT-001',
        expect.objectContaining({
          alert_id: 'ALERT-001',
          delivered_channels: ['IN_APP'],
          delivered_at: expect.any(String) as string,
        }),
      );
    });

    it('should publish to alerts.delivered with empty channels when VOICE is skipped (low severity)', async () => {
      const payload: AlertDeliveryPayload = {
        ...basePayload,
        channels: ['VOICE'],
        severity: 'low',
      };

      await dispatcher.dispatch(payload);

      expect(mockKafkaProducer.publish).toHaveBeenCalledWith(
        'alerts.delivered',
        'ALERT-001',
        expect.objectContaining({
          delivered_channels: [],
        }),
      );
    });

    it('should always call Kafka publish even if a channel delivery throws', async () => {
      mockWsGateway.sendToRM.mockImplementationOnce(() => {
        throw new Error('WebSocket send failed');
      });

      const payload: AlertDeliveryPayload = { ...basePayload, channels: ['IN_APP'] };

      await dispatcher.dispatch(payload);

      // Kafka publish still called despite WebSocket failure
      expect(mockKafkaProducer.publish).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-channel dispatch
  // -------------------------------------------------------------------------

  describe('dispatch() with multiple channels', () => {
    it('should deliver both IN_APP and VOICE for high severity', async () => {
      const payload: AlertDeliveryPayload = {
        ...basePayload,
        channels: ['IN_APP', 'VOICE'],
        severity: 'high',
      };

      await dispatcher.dispatch(payload);

      expect(mockWsGateway.sendToRM).toHaveBeenCalledTimes(1);
      expect(mockVoiceService.initiateCall).toHaveBeenCalledTimes(1);
      expect(mockKafkaProducer.publish).toHaveBeenCalledWith(
        'alerts.delivered',
        'ALERT-001',
        expect.objectContaining({
          delivered_channels: ['IN_APP', 'VOICE'],
        }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// AlertTemplateService unit tests
// ---------------------------------------------------------------------------

describe('AlertTemplateService', () => {
  let service: AlertTemplateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AlertTemplateService],
    }).compile();

    service = module.get<AlertTemplateService>(AlertTemplateService);
  });

  describe('formatInApp()', () => {
    it('should return an InAppNotification with correct shape', () => {
      const result = service.formatInApp(basePayload);

      expect(result).toEqual<InAppNotification>({
        alert_id: 'ALERT-001',
        title: 'Idle Cash Alert',
        message: 'Client Arun Sharma has cash idle for more than 30 days.',
        severity: 'high',
        alert_type: 'IDLE_CASH',
        client_name: 'Arun Sharma',
        action_suggestion: 'Consider recommending liquid funds.',
        created_at: '2026-03-10T10:00:00.000Z',
      });
    });

    it('should pass through the exact alert_id without mutation', () => {
      const result = service.formatInApp({ ...basePayload, alert_id: 'ALERT-XYZ-999' });
      expect(result.alert_id).toBe('ALERT-XYZ-999');
    });
  });

  describe('formatVoice()', () => {
    it('should return a conversational string containing the client name', () => {
      const result = service.formatVoice(basePayload);

      expect(typeof result).toBe('string');
      expect(result).toContain('Arun Sharma');
    });

    it('should address the RM by first name', () => {
      const result = service.formatVoice(basePayload);

      // rm_name is "Rajesh Kumar" — first name should be "Rajesh"
      expect(result).toContain('Rajesh');
    });

    it('should include urgency phrase for CRITICAL severity', () => {
      const result = service.formatVoice({ ...basePayload, severity: 'critical' });

      expect(result).toContain('immediately');
    });

    it('should include polite phrase for non-critical severity', () => {
      const result = service.formatVoice({ ...basePayload, severity: 'medium' });

      expect(result).toContain('earliest convenience');
    });
  });
});
