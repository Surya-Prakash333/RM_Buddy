import { Test, TestingModule } from '@nestjs/testing';
import {
  KafkaService,
  KafkaMessage,
  KAFKA_PRODUCER,
  KAFKA_CONSUMER,
} from '../kafka.service';

/**
 * We do NOT call jest.mock('kafkajs') because kafkajs may not be installed
 * in CI until `npm install` is run.  Instead, we inject fully-typed mock
 * objects via the NestJS DI tokens (KAFKA_PRODUCER / KAFKA_CONSUMER).
 *
 * This is the correct pattern for testing services that depend on injected
 * infrastructure clients — identical to how CacheService mocks ioredis.
 */

// ---------------------------------------------------------------------------
// Mock type helpers
// ---------------------------------------------------------------------------

interface MockProducer {
  connect: jest.Mock;
  disconnect: jest.Mock;
  send: jest.Mock;
}

interface MockConsumer {
  connect: jest.Mock;
  disconnect: jest.Mock;
  subscribe: jest.Mock;
  run: jest.Mock;
}

function buildMockProducer(): MockProducer {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue({ topicName: 'test', partition: 0 }),
  };
}

function buildMockConsumer(): MockConsumer {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    run: jest.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('KafkaService', () => {
  let service: KafkaService;
  let mockProducer: MockProducer;
  let mockConsumer: MockConsumer;

  beforeEach(async () => {
    mockProducer = buildMockProducer();
    mockConsumer = buildMockConsumer();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KafkaService,
        { provide: KAFKA_PRODUCER, useValue: mockProducer },
        { provide: KAFKA_CONSUMER, useValue: mockConsumer },
      ],
    }).compile();

    service = module.get<KafkaService>(KafkaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // onModuleInit — producer connect
  // -------------------------------------------------------------------------

  describe('onModuleInit', () => {
    it('connects the producer on module init', async () => {
      await service.onModuleInit();

      expect(mockProducer.connect).toHaveBeenCalledTimes(1);
    });

    it('re-throws when producer.connect() rejects', async () => {
      mockProducer.connect.mockRejectedValueOnce(new Error('Broker unreachable'));

      await expect(service.onModuleInit()).rejects.toThrow('Broker unreachable');
    });
  });

  // -------------------------------------------------------------------------
  // onModuleDestroy — producer disconnect
  // -------------------------------------------------------------------------

  describe('onModuleDestroy', () => {
    it('disconnects the producer on module destroy', async () => {
      await service.onModuleDestroy();

      expect(mockProducer.disconnect).toHaveBeenCalledTimes(1);
    });

    it('does not throw when producer.disconnect() rejects (swallows error gracefully)', async () => {
      mockProducer.disconnect.mockRejectedValueOnce(new Error('Already disconnected'));

      // Should resolve without throwing
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // publish
  // -------------------------------------------------------------------------

  describe('publish', () => {
    it('sends a message to the correct topic with the given key and JSON-serialised value', async () => {
      const payload = { rmId: 'rm-001', alertType: 'PORTFOLIO_DRIFT', severity: 'HIGH' };

      await service.publish('alerts.generated', 'rm-001', payload);

      expect(mockProducer.send).toHaveBeenCalledTimes(1);
      expect(mockProducer.send).toHaveBeenCalledWith({
        topic: 'alerts.generated',
        messages: [
          {
            key: 'rm-001',
            value: JSON.stringify(payload),
          },
        ],
      });
    });

    it('JSON-serialises nested objects correctly', async () => {
      const payload = { nested: { deep: { value: 42 } }, arr: [1, 2, 3] };

      await service.publish('audit.trail', 'rm-002', payload);

      const sentRecord = mockProducer.send.mock.calls[0][0] as {
        messages: Array<{ value: string }>;
      };
      expect(JSON.parse(sentRecord.messages[0].value)).toEqual(payload);
    });

    it('re-throws when producer.send() rejects', async () => {
      mockProducer.send.mockRejectedValueOnce(new Error('Leader not available'));

      await expect(
        service.publish('alerts.generated', 'rm-001', { foo: 'bar' }),
      ).rejects.toThrow('Leader not available');
    });
  });

  // -------------------------------------------------------------------------
  // subscribe
  // -------------------------------------------------------------------------

  describe('subscribe', () => {
    it('connects the consumer, subscribes to the topic, and calls run', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      await service.subscribe('agent.request', handler);

      expect(mockConsumer.connect).toHaveBeenCalledTimes(1);
      expect(mockConsumer.subscribe).toHaveBeenCalledWith({
        topic: 'agent.request',
        fromBeginning: false,
      });
      expect(mockConsumer.run).toHaveBeenCalledTimes(1);
    });

    it('calls the handler with a normalised KafkaMessage when eachMessage fires', async () => {
      const receivedMessages: KafkaMessage[] = [];
      const handler = jest.fn().mockImplementation(async (msg: KafkaMessage) => {
        receivedMessages.push(msg);
      });

      // Capture the eachMessage callback registered via consumer.run()
      let capturedEachMessage: ((payload: unknown) => Promise<void>) | undefined;
      mockConsumer.run.mockImplementationOnce(
        async (opts: { eachMessage: (payload: unknown) => Promise<void> }) => {
          capturedEachMessage = opts.eachMessage;
        },
      );

      await service.subscribe('agent.request', handler);

      // Simulate an incoming Kafka message
      const incomingPayload = { rmId: 'rm-003', query: 'Show portfolio summary' };
      await capturedEachMessage!({
        topic: 'agent.request',
        partition: 0,
        message: {
          key: Buffer.from('rm-003'),
          value: Buffer.from(JSON.stringify(incomingPayload)),
          offset: '42',
          timestamp: '1700000000000',
        },
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(receivedMessages[0]).toEqual<KafkaMessage>({
        topic: 'agent.request',
        key: 'rm-003',
        value: incomingPayload,
        offset: '42',
        timestamp: '1700000000000',
      });
    });

    it('handles null key and null value gracefully', async () => {
      const receivedMessages: KafkaMessage[] = [];
      const handler = jest.fn().mockImplementation(async (msg: KafkaMessage) => {
        receivedMessages.push(msg);
      });

      let capturedEachMessage: ((payload: unknown) => Promise<void>) | undefined;
      mockConsumer.run.mockImplementationOnce(
        async (opts: { eachMessage: (payload: unknown) => Promise<void> }) => {
          capturedEachMessage = opts.eachMessage;
        },
      );

      await service.subscribe('audit.trail', handler);

      await capturedEachMessage!({
        topic: 'audit.trail',
        partition: 0,
        message: {
          key: null,
          value: null,
          offset: '0',
          timestamp: '1700000000001',
        },
      });

      expect(receivedMessages[0].key).toBeNull();
      expect(receivedMessages[0].value).toBeNull();
    });

    it('does not throw when the message value is malformed JSON (logs and continues)', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      let capturedEachMessage: ((payload: unknown) => Promise<void>) | undefined;
      mockConsumer.run.mockImplementationOnce(
        async (opts: { eachMessage: (payload: unknown) => Promise<void> }) => {
          capturedEachMessage = opts.eachMessage;
        },
      );

      await service.subscribe('alerts.generated', handler);

      // Should not throw even with invalid JSON
      await expect(
        capturedEachMessage!({
          topic: 'alerts.generated',
          partition: 0,
          message: {
            key: Buffer.from('rm-004'),
            value: Buffer.from('NOT_VALID_JSON{{{'),
            offset: '5',
            timestamp: '1700000000002',
          },
        }),
      ).resolves.toBeUndefined();

      // Handler is still called — just with null value
      expect(handler).toHaveBeenCalledTimes(1);
      expect((handler.mock.calls[0][0] as KafkaMessage).value).toBeNull();
    });

    it('re-throws when consumer.connect() rejects', async () => {
      mockConsumer.connect.mockRejectedValueOnce(new Error('Consumer broker error'));

      await expect(
        service.subscribe('alerts.generated', jest.fn()),
      ).rejects.toThrow('Consumer broker error');
    });
  });
});
