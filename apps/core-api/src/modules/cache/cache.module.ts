import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
// ioredis is imported only here (not in cache.service.ts) so that
// the service is testable without the package being installed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Redis = require('ioredis');
import redisConfig from '../../config/redis.config';
import { CacheService, REDIS_CLIENT } from './cache.service';

/**
 * CacheModule wires up the ioredis client and the CacheService.
 *
 * The Redis connection is created via an async factory so that:
 *   1. Configuration is loaded from the environment at startup.
 *   2. The raw Redis instance is fully injectable for testing (can be mocked).
 *
 * Do NOT use @nestjs/cache-manager — we manage the ioredis client directly
 * for fine-grained control over key patterns, TTLs, and write-through logic.
 */
@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('redis.host', 'localhost');
        const port = configService.get<number>('redis.port', 6379);
        const password = configService.get<string | undefined>('redis.password');
        const db = configService.get<number>('redis.db', 0);

        return new Redis({
          host,
          port,
          db,
          ...(password ? { password } : {}),
          // Reconnect with exponential backoff, max 10s
          retryStrategy: (times: number): number =>
            Math.min(times * 200, 10_000),
          lazyConnect: false,
          enableReadyCheck: true,
        });
      },
    },
    CacheService,
  ],
  exports: [CacheService],
})
export class CacheModule {}
