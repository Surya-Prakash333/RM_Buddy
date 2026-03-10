import { Test, TestingModule } from '@nestjs/testing';
import { CacheService, REDIS_CLIENT } from '../cache.service';

/**
 * We do NOT call jest.mock('ioredis') because ioredis may not be installed in
 * CI until `npm install` is run. Instead, we inject a fully-typed mock object
 * via the NestJS DI token (REDIS_CLIENT). This is the correct pattern for
 * testing services that depend on injected infrastructure clients.
 */

/** Minimal Redis client interface that CacheService actually uses. */
interface MockRedisClient {
  get: jest.Mock;
  setex: jest.Mock;
  del: jest.Mock;
  keys: jest.Mock;
  ping: jest.Mock;
}

function buildMockRedis(): MockRedisClient {
  return {
    get: jest.fn(),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    keys: jest.fn().mockResolvedValue([]),
    ping: jest.fn().mockResolvedValue('PONG'),
  };
}

describe('CacheService', () => {
  let service: CacheService;
  let mockRedis: MockRedisClient;

  beforeEach(async () => {
    mockRedis = buildMockRedis();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        {
          provide: REDIS_CLIENT,
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // readThrough
  // ---------------------------------------------------------------------------

  describe('readThrough', () => {
    it('returns parsed cached data on Redis HIT without calling fetchFn', async () => {
      const cachedData = { clientId: 'c-123', name: 'Arjun Mehta' };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedData));

      const fetchFn = jest.fn().mockResolvedValue({ clientId: 'c-999', name: 'Other' });

      const result = await service.readThrough('clients:rm:rm-01', fetchFn, 900);

      expect(result).toEqual(cachedData);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('calls fetchFn on cache MISS and caches the result in Redis', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const freshData = { clientId: 'c-456', name: 'Priya Sharma' };
      const fetchFn = jest.fn().mockResolvedValue(freshData);

      const result = await service.readThrough('clients:rm:rm-02', fetchFn, 900);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(freshData);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'clients:rm:rm-02',
        900,
        JSON.stringify(freshData),
      );
    });

    it('returns null and does not cache when fetchFn returns null on MISS', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const fetchFn = jest.fn().mockResolvedValue(null);

      const result = await service.readThrough('clients:rm:rm-03', fetchFn, 900);

      expect(result).toBeNull();
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // writeThrough
  // ---------------------------------------------------------------------------

  describe('writeThrough', () => {
    it('calls saveFn first then writes the result to Redis', async () => {
      const savedDoc = { sessionId: 's-001', rmId: 'rm-01', status: 'active' };
      const saveFn = jest.fn().mockResolvedValue(savedDoc);

      const result = await service.writeThrough('session:s-001', saveFn, 86400);

      expect(saveFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(savedDoc);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'session:s-001',
        86400,
        JSON.stringify(savedDoc),
      );
    });

    it('propagates errors thrown by saveFn without caching', async () => {
      const saveFn = jest.fn().mockRejectedValue(new Error('MongoDB write failed'));

      await expect(service.writeThrough('session:s-bad', saveFn, 86400)).rejects.toThrow(
        'MongoDB write failed',
      );

      expect(mockRedis.setex).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // invalidate
  // ---------------------------------------------------------------------------

  describe('invalidate', () => {
    it('calls Redis del with the specified key', async () => {
      await service.invalidate('session:s-001');

      expect(mockRedis.del).toHaveBeenCalledWith('session:s-001');
    });
  });

  // ---------------------------------------------------------------------------
  // invalidatePattern
  // ---------------------------------------------------------------------------

  describe('invalidatePattern', () => {
    it('finds matching keys then deletes them all', async () => {
      const matchedKeys = ['alerts:rm:rm-01', 'alerts:rm:rm-02', 'alerts:rm:rm-03'];
      mockRedis.keys.mockResolvedValueOnce(matchedKeys);

      await service.invalidatePattern('alerts:rm:*');

      expect(mockRedis.keys).toHaveBeenCalledWith('alerts:rm:*');
      expect(mockRedis.del).toHaveBeenCalledWith(...matchedKeys);
    });

    it('does not call del when no keys match the pattern', async () => {
      mockRedis.keys.mockResolvedValueOnce([]);

      await service.invalidatePattern('alerts:rm:nonexistent:*');

      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // ping
  // ---------------------------------------------------------------------------

  describe('ping', () => {
    it('returns true when Redis responds PONG', async () => {
      mockRedis.ping.mockResolvedValueOnce('PONG');

      const alive = await service.ping();

      expect(alive).toBe(true);
    });

    it('returns false when Redis throws an error', async () => {
      mockRedis.ping.mockRejectedValueOnce(new Error('Connection refused'));

      const alive = await service.ping();

      expect(alive).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // get (basic)
  // ---------------------------------------------------------------------------

  describe('get', () => {
    it('returns parsed value on HIT', async () => {
      const data = { foo: 'bar' };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(data));

      const result = await service.get<typeof data>('some:key');

      expect(result).toEqual(data);
    });

    it('returns null on MISS with no fetchFn', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const result = await service.get('some:missing:key');

      expect(result).toBeNull();
    });

    it('falls back to fetchFn and caches on MISS', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const fallbackData = { id: '1', value: 42 };
      const fetchFn = jest.fn().mockResolvedValue(fallbackData);

      const result = await service.get('some:key:2', fetchFn);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(fallbackData);
      expect(mockRedis.setex).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // warmup
  // ---------------------------------------------------------------------------

  describe('warmup', () => {
    it('calls fetchFn and caches all returned key-value pairs', async () => {
      const warmupData: Record<string, unknown> = {
        'clients:rm:rm-01': [{ id: 'c1' }],
        'dashboard:rm:rm-01': { aum: 1_000_000 },
      };
      const fetchFn = jest.fn().mockResolvedValue(warmupData);

      await service.warmup('rm-01', fetchFn);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(mockRedis.setex).toHaveBeenCalledTimes(Object.keys(warmupData).length);
    });
  });
});
