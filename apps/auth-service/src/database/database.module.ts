import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import databaseConfig from '../config/database.config';
import { RMSession, RMSessionSchema } from './models/rm-session.model';

/**
 * DatabaseModule wires up the Mongoose connection and registers all schemas
 * used within the auth-service.
 *
 * The connection is created via an async factory so that the MONGODB_URI is
 * read from environment at startup, not at module load time.
 */
@Module({
  imports: [
    ConfigModule.forFeature(databaseConfig),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('database.uri', 'mongodb://localhost:27017/rmbuddy'),
        retryWrites: true,
        w: 'majority',
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      }),
    }),
    MongooseModule.forFeature([{ name: RMSession.name, schema: RMSessionSchema }]),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
