import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { SsoModule } from './modules/sso/sso.module';

/**
 * AppModule is the root module of the auth-service.
 *
 * Module load order:
 *  1. ConfigModule   — environment variables available application-wide (global).
 *  2. DatabaseModule — Mongoose connection and schema registration.
 *  3. SsoModule      — SSO validation and auth HTTP endpoints.
 *                      SsoModule imports SessionModule internally, so
 *                      SessionModule does not need to be listed here.
 *
 * ConfigModule is marked global so feature configs registered in child modules
 * (database.config, redis.config) are accessible via ConfigService everywhere.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.ENV_FILE || '.env',
      ignoreEnvFile: process.env.NODE_ENV === 'production',
    }),
    DatabaseModule,
    SsoModule,
  ],
})
export class AppModule {}
