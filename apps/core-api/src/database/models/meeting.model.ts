import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MeetingDocument = Meeting & Document;

@Schema({ timestamps: true, collection: 'meetings' })
export class Meeting {
  @Prop({ required: true, unique: true, index: true })
  meeting_id!: string;

  @Prop({ required: true, index: true })
  rm_id!: string;

  @Prop()
  client_id!: string;

  @Prop()
  client_name!: string;

  @Prop()
  client_tier!: string;

  @Prop()
  meeting_type!: string;

  @Prop()
  status!: string;

  @Prop({ index: true })
  scheduled_date!: Date;

  @Prop()
  scheduled_time!: string;

  @Prop()
  duration_minutes!: number;

  @Prop()
  agenda!: string;

  @Prop()
  notes!: string;

  @Prop()
  outcome!: string;

  @Prop()
  location!: string;

  @Prop()
  priority!: string;

  @Prop()
  crm_last_synced!: Date;
}

export const MeetingSchema = SchemaFactory.createForClass(Meeting);

MeetingSchema.index({ rm_id: 1, scheduled_date: 1 });
MeetingSchema.index({ rm_id: 1, status: 1 });
