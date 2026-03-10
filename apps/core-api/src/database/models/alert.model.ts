import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AlertDocument = AlertRecord & Document;

@Schema({ timestamps: true, collection: 'alerts' })
export class AlertRecord {
  @Prop({ required: true, unique: true, index: true })
  alert_id!: string;

  @Prop({ required: true, index: true })
  alert_type!: string;

  @Prop({ required: true, index: true })
  rm_id!: string;

  @Prop()
  client_id!: string;

  @Prop()
  client_name!: string;

  @Prop()
  client_tier!: string;

  @Prop({ index: true })
  severity!: string;

  @Prop({ index: true })
  status!: string;

  @Prop()
  title!: string;

  @Prop()
  message!: string;

  @Prop({ type: Object })
  data!: Record<string, any>;

  @Prop()
  action_suggestion!: string;

  @Prop()
  delivered_at!: Date;

  @Prop()
  acknowledged_at!: Date;

  @Prop()
  acted_at!: Date;

  @Prop({ index: true, expires: 0 })
  expires_at!: Date;

  @Prop()
  rule_id!: string;
}

export const AlertSchema = SchemaFactory.createForClass(AlertRecord);

AlertSchema.index({ rm_id: 1, status: 1, createdAt: -1 });
AlertSchema.index({ rm_id: 1, alert_type: 1, client_id: 1 });
