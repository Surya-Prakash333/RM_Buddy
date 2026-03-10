import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RMSessionDocument = RMSession & Document;

@Schema({ timestamps: true, collection: 'rm_sessions' })
export class RMSession {
  @Prop({ required: true, unique: true, index: true })
  session_id!: string;

  @Prop({ required: true, index: true })
  rm_id!: string;

  @Prop()
  rm_name!: string;

  @Prop()
  rm_code!: string;

  @Prop()
  rm_email!: string;

  @Prop()
  rm_branch!: string;

  @Prop()
  rm_region!: string;

  @Prop()
  role!: string;

  @Prop()
  token!: string;

  @Prop()
  expires_at!: Date;

  @Prop()
  last_active!: Date;

  @Prop()
  ip_address!: string;

  @Prop()
  user_agent!: string;

  @Prop({ default: true })
  is_active!: boolean;
}

export const RMSessionSchema = SchemaFactory.createForClass(RMSession);

RMSessionSchema.index({ rm_id: 1, is_active: 1 });
RMSessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
