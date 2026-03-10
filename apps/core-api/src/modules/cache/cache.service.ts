import { Injectable, Inject, Logger } from '@nestjs/common';

/**
 * Minimal interface for the Redis client methods used by CacheService.
 *
 * Defined locally so that CacheService has NO direct import from 'ioredis'.
 * The real ioredis instance satisfies this interface at runtime; tests inject
 * a plain object mock without needing the package installed.
 */
export interface IRedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<'OK' | unknown>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  ping(): Promise<string>;
}

/**
 * Key naming constants for consistent Redis key patterns.
 * Pattern: {domain}:{id}:{field}
 */
export const CACHE_KEYS = {
  session: (sessionId: string): string => `session:${sessionId}`,
  rmClientList: (rmId: string): string => `clients:rm:${rmId}`,
  rmAlertList: (rmId: string): string => `alerts:rm:${rmId}`,
  rmDashboard: (rmId: string): string => `dashboard:rm:${rmId}`,
  workingMemory: (rmId: string, sessionId: string): string =>
    `memory:rm:${rmId}:session:${sessionId}`,
} as const;

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Write-through cache service.
 *
 * Principle: MongoDB is the source of truth; Redis is the cache layer.
 * - Reads: Redis first, MongoDB fallback.
 * - Writes: MongoDB first (via caller's saveFn), then Redis.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: IRedisClient) {}

  /**
   * Get a value from Redis. On cache miss, optionally call fetchFn (MongoDB
   * fallback) and populate the cache with a default TTL of 300 s.
   */
  async get<T>(key: string, fetchFn?: () => Promise<T | null>): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw !== null) {
        this.logger.debug(`Cache HIT: ${key}`);
        return JSON.parse(raw) as T;
      }

      this.logger.debug(`Cache MISS: ${key}`);

      if (!fetchFn) {
        return null;
      }

      const value = await fetchFn();
      if (value !== null && value !== undefined) {
        await this.set(key, value, 300);
      }
      return value;
    } catch (err) {
      this.logger.error(`Cache get error for key "${key}": ${(err as Error).message}`);
      return fetchFn ? fetchFn() : null;
    }
  }

  /**
   * Write a value to Redis with an explicit TTL (seconds).
   */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
      this.logger.debug(`Cache SET: ${key} (TTL: ${ttlSeconds}s)`);
    } catch (err) {
      this.logger.error(`Cache set error for key "${key}": ${(err as Error).message}`);
    }
  }

  /**
   * Write-through pattern: persist to MongoDB via saveFn first, then cache in Redis.
   * Ensures MongoDB is always the source of truth.
   */
  async writeThrough<T>(
    key: string,
    saveFn: () => Promise<T>,
    ttlSeconds: number,
  ): Promise<T> {
    const value = await saveFn();
    await this.set(key, value, ttlSeconds);
    this.logger.debug(`Write-through complete: ${key}`);
    return value;
  }

  /**
   * Read-through pattern: return cached value if available, otherwise call
   * fetchFn (MongoDB read) and cache the result.
   */
  async readThrough<T>(
    key: string,
    fetchFn: () => Promise<T | null>,
    ttlSeconds: number,
  ): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw !== null) {
        this.logger.debug(`Read-through HIT: ${key}`);
        return JSON.parse(raw) as T;
      }

      this.logger.debug(`Read-through MISS: ${key} — fetching from source`);
      const value = await fetchFn();
      if (value !== null && value !== undefined) {
        await this.set(key, value, ttlSeconds);
      }
      return value;
    } catch (err) {
      this.logger.error(`Read-through error for key "${key}": ${(err as Error).message}`);
      return fetchFn();
    }
  }

  /**
   * Remove a single key from Redis.
   */
  async invalidate(key: string): Promise<void> {
    try {
      await this.redis.del(key);
      this.logger.debug(`Cache INVALIDATED: ${key}`);
    } catch (err) {
      this.logger.error(`Cache invalidate error for key "${key}": ${(err as Error).message}`);
    }
  }

  /**
   * Remove all keys matching a glob pattern.
   * NOTE: Uses KEYS — suitable for low-cardinality management operations only.
   * For high-traffic production use, prefer SCAN-based iteration.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length === 0) {
        this.logger.debug(`No keys matched pattern: ${pattern}`);
        return;
      }
      await this.redis.del(...keys);
      this.logger.debug(`Cache INVALIDATED ${keys.length} keys matching: ${pattern}`);
    } catch (err) {
      this.logger.error(
        `Cache invalidatePattern error for pattern "${pattern}": ${(err as Error).message}`,
      );
    }
  }

  /**
   * Pre-populate the cache for an RM by calling fetchFn which returns a map of
   * cache key → value pairs. Each entry is cached with a 24h TTL.
   */
  async warmup(
    rmId: string,
    fetchFn: () => Promise<Record<string, unknown>>,
  ): Promise<void> {
    this.logger.log(`Cache warmup started for RM: ${rmId}`);
    try {
      const data = await fetchFn();
      const entries = Object.entries(data);

      await Promise.all(
        entries.map(([key, value]) => this.set(key, value, 86400)),
      );

      this.logger.log(`Cache warmup complete for RM ${rmId}: ${entries.length} keys populated`);
    } catch (err) {
      this.logger.error(`Cache warmup failed for RM ${rmId}: ${(err as Error).message}`);
    }
  }

  /**
   * Health check — ping Redis and return true if reachable.
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (err) {
      this.logger.error(`Redis ping failed: ${(err as Error).message}`);
      return false;
    }
  }
}
