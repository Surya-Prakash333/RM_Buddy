import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AuditDocument = AuditTrail & Document;

@Schema({ timestamps: true, collection: 'audit_trail' })
export class AuditTrail {
  @Prop({ required: true, index: true })
  rm_id!: string;

  @Prop({ required: true })
  action!: string;

  @Prop()
  resource_type!: string;

  @Prop()
  resource_id!: string;

  @Prop({ type: Object })
  request!: Record<string, any>;

  @Prop({ type: Object })
  response!: Record<string, any>;

  @Prop()
  status!: string;

  @Prop()
  ip_address!: string;

  @Prop()
  user_agent!: string;

  @Prop()
  duration_ms!: number;

  @Prop()
  error_message!: string;
}

export const AuditSchema = SchemaFactory.createForClass(AuditTrail);

AuditSchema.index({ rm_id: 1, createdAt: -1 });
AuditSchema.index({ action: 1, createdAt: -1 });
AuditSchema.index({ resource_type: 1, resource_id: 1 });
