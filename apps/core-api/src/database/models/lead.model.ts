import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LeadDocument = Lead & Document;

@Schema({ timestamps: true, collection: 'leads' })
export class Lead {
  @Prop({ required: true, unique: true, index: true })
  lead_id!: string;

  @Prop({ required: true, index: true })
  rm_id!: string;

  @Prop()
  client_id!: string;

  @Prop()
  client_name!: string;

  @Prop()
  category!: string;

  @Prop()
  asset_class!: string;

  @Prop()
  estimated_amount!: number;

  @Prop()
  source!: string;

  @Prop()
  status!: string;

  @Prop()
  created_date!: Date;

  @Prop({ index: true })
  expiry_date!: Date;

  @Prop()
  last_contact!: Date;

  @Prop()
  notes!: string;

  @Prop()
  crm_last_synced!: Date;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);

LeadSchema.index({ rm_id: 1, status: 1 });
LeadSchema.index({ rm_id: 1, expiry_date: 1 });
