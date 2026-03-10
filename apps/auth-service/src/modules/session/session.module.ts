import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { RMSession, RMSessionSchema } from '../../database/models/rm-session.model';
import { SessionService, SESSION_REDIS_CLIENT, SESSION_MODEL } from './session.service';
import redisConfig from '../../config/redis.config';

// ioredis is required only inside the factory, never at module scope, so that
// SessionService remains testable without the package installed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Redis = require('ioredis');

/**
 * SessionModule wires up the Redis client and Mongoose model that SessionService
 * depends on, following the same DI-token pattern used by CacheModule in core-api.
 *
 * Two custom providers use Symbol injection tokens so unit tests can supply
 * plain object mocks via useValue without needing ioredis or mongoose installed.
 */
@Module({
  imports: [
    ConfigModule.forFeature(redisConfig),
    MongooseModule.forFeature([{ name: RMSession.name, schema: RMSessionSchema }]),
  ],
  providers: [
    // Redis client injected via token — testable without ioredis installed
    {
      provide: SESSION_REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('redis.host', 'localhost');
        const port = configService.get<number>('redis.port', 6379);
        const password = configService.get<string | undefined>('redis.password');

        return new Redis({
          host,
          port,
          ...(password ? { password } : {}),
          retryStrategy: (times: number): number => Math.min(times * 200, 10_000),
          lazyConnect: false,
          enableReadyCheck: true,
        });
      },
    },
    // Mongoose model injected via Symbol token — testable without mongoose installed
    {
      provide: SESSION_MODEL,
      inject: [getModelToken(RMSession.name)],
      useFactory: (model: unknown) => model,
    },
    // Session TTL — sourced from config, fallback to 24h
    {
      provide: 'SESSION_TTL',
      inject: [ConfigService],
      useFactory: (configService: ConfigService): number =>
        configService.get<number>('redis.sessionTtl', 86400),
    },
    SessionService,
  ],
  exports: [SessionService],
})
export class SessionModule {}
