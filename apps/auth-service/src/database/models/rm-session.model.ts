import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RMSessionDocument = RMSession & Document;

/**
 * Mongoose schema for the rm_sessions collection.
 *
 * MongoDB acts as the durable source of truth for sessions.
 * Redis is the primary read path; MongoDB is the fallback / backup.
 *
 * TTL index on expires_at removes documents automatically once a session
 * expires, so the collection does not grow unboundedly.
 */
@Schema({ timestamps: true, collection: 'rm_sessions' })
export class RMSession {
  @Prop({ required: true, unique: true, index: true })
  session_id!: string;

  @Prop({ required: true, index: true })
  rm_id!: string;

  @Prop({ required: true })
  rm_name!: string;

  @Prop({ required: true })
  rm_code!: string;

  @Prop({ required: true })
  rm_email!: string;

  @Prop({ required: true })
  rm_branch!: string;

  @Prop({ required: true })
  rm_region!: string;

  @Prop({ required: true })
  role!: string;

  @Prop({ required: true })
  expires_at!: Date;

  @Prop({ required: true })
  created_at_ts!: Date;

  @Prop({ default: 'active', enum: ['active', 'expired', 'revoked'] })
  status!: string;
}

export const RMSessionSchema = SchemaFactory.createForClass(RMSession);

// Compound index for fast active-session lookups by RM
RMSessionSchema.index({ rm_id: 1, status: 1 });

// MongoDB TTL index: document is removed expires_at seconds after the field value
RMSessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
