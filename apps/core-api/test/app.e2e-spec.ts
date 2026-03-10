/**
 * E2E test suite for core-api.
 *
 * Infrastructure strategy:
 *   - MongoDB   → MongoMemoryServer (in-process, no external daemon needed)
 *   - Redis     → jest mock object injected via REDIS_CLIENT token
 *   - Kafka     → jest mock objects injected via KAFKA_PRODUCER / KAFKA_CONSUMER tokens
 *
 * All authenticated routes require the x-rm-identity header (base64-encoded JSON).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Module } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { DatabaseModule } from '../src/config/database.module';
import { CacheModule } from '../src/modules/cache/cache.module';
import { KafkaModule } from '../src/modules/kafka/kafka.module';
import { CacheService, REDIS_CLIENT } from '../src/modules/cache/cache.service';
import { KAFKA_PRODUCER, KAFKA_CONSUMER } from '../src/modules/kafka/kafka.service';

// ---------------------------------------------------------------------------
// Mock RM Identity header (base64-encoded JSON matching AuthGuard)
// ---------------------------------------------------------------------------

const mockIdentity = Buffer.from(
  JSON.stringify({
    rm_id: 'RM001',
    name: 'Rajesh Kumar',
    role: 'RM',
    branch: 'Mumbai-BKC',
    session_id: 'test-session-001',
  }),
).toString('base64');

// ---------------------------------------------------------------------------
// Redis stub
// ---------------------------------------------------------------------------

const redisMock = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  hget: jest.fn().mockResolvedValue(null),
  hset: jest.fn().mockResolvedValue(1),
  hgetall: jest.fn().mockResolvedValue(null),
  expire: jest.fn().mockResolvedValue(1),
  keys: jest.fn().mockResolvedValue([]),
  pipeline: jest.fn().mockReturnValue({
    hset: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  }),
  disconnect: jest.fn(),
  quit: jest.fn().mockResolvedValue('OK'),
  status: 'ready',
};

// ---------------------------------------------------------------------------
// Kafka stubs
// ---------------------------------------------------------------------------

const kafkaProducerMock = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue([]),
};

const kafkaConsumerMock = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  subscribe: jest.fn().mockResolvedValue(undefined),
  run: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
};

// ---------------------------------------------------------------------------
// Replacement modules
// ---------------------------------------------------------------------------

@Module({
  providers: [
    { provide: REDIS_CLIENT, useValue: redisMock },
    CacheService,
  ],
  exports: [CacheService],
})
class MockedCacheModule {}

@Module({
  providers: [
    { provide: KAFKA_PRODUCER, useValue: kafkaProducerMock },
    { provide: KAFKA_CONSUMER, useValue: kafkaConsumerMock },
  ],
  exports: [KAFKA_PRODUCER, KAFKA_CONSUMER],
})
class MockedKafkaModule {}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Core API E2E', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;

  jest.setTimeout(60_000);

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const mongoUri = mongod.getUri();

    @Module({
      imports: [MongooseModule.forRoot(mongoUri)],
      exports: [MongooseModule],
    })
    class InMemoryDatabaseModule {}

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(InMemoryDatabaseModule)
      .overrideModule(CacheModule)
      .useModule(MockedCacheModule)
      .overrideModule(KafkaModule)
      .useModule(MockedKafkaModule)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  describe('Health', () => {
    it('GET /health returns 200', () =>
      request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBeDefined();
        }));

    it('GET /ready returns 200', () =>
      request(app.getHttpServer()).get('/ready').expect(200));
  });

  describe('Auth guard', () => {
    it('GET /api/v1/dashboard/summary → 401 without identity header', () =>
      request(app.getHttpServer()).get('/api/v1/dashboard/summary').expect(401));

    it('GET /api/v1/clients → 401 without identity header', () =>
      request(app.getHttpServer()).get('/api/v1/clients').expect(401));

    it('GET /api/v1/alerts → 401 without identity header', () =>
      request(app.getHttpServer()).get('/api/v1/alerts').expect(401));
  });

  describe('Dashboard endpoints', () => {
    it('GET /api/v1/dashboard/summary → 200 with identity', () =>
      request(app.getHttpServer())
        .get('/api/v1/dashboard/summary')
        .set('x-rm-identity', mockIdentity)
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('success');
          expect(res.body.data).toBeDefined();
        }));

    it('GET /api/v1/clients → 200', () =>
      request(app.getHttpServer())
        .get('/api/v1/clients')
        .set('x-rm-identity', mockIdentity)
        .expect(200));

    it('GET /api/v1/alerts → 200', () =>
      request(app.getHttpServer())
        .get('/api/v1/alerts')
        .set('x-rm-identity', mockIdentity)
        .expect(200));
  });

  describe('Briefing', () => {
    it('GET /api/v1/briefing/today → 200', () =>
      request(app.getHttpServer())
        .get('/api/v1/briefing/today')
        .set('x-rm-identity', mockIdentity)
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('success');
        }));
  });

  describe('Daily Actions', () => {
    it('GET /api/v1/daily-actions → 200', () =>
      request(app.getHttpServer())
        .get('/api/v1/daily-actions')
        .set('x-rm-identity', mockIdentity)
        .expect(200));
  });
});
