import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ClientDocument = Client & Document;

@Schema({ timestamps: true, collection: 'clients' })
export class Client {
  @Prop({ required: true, unique: true, index: true })
  client_id!: string;

  @Prop({ required: true, index: true })
  rm_id!: string;

  @Prop({ required: true })
  client_name!: string;

  @Prop()
  email!: string;

  @Prop()
  phone!: string;

  @Prop()
  pan!: string;

  @Prop()
  dob!: Date;

  @Prop({ index: true })
  tier!: string;

  @Prop()
  risk_profile!: string;

  @Prop()
  kyc_status!: string;

  @Prop()
  onboarding_date!: Date;

  @Prop({ index: true })
  last_interaction!: Date;

  @Prop()
  total_aum!: number;

  @Prop()
  total_revenue_ytd!: number;

  @Prop({ type: [{ account_id: String, account_type: String, status: String, opening_date: Date, current_value: Number }] })
  accounts!: Array<{
    account_id: string;
    account_type: string;
    status: string;
    opening_date: Date;
    current_value: number;
  }>;

  @Prop({ type: [String] })
  tags!: string[];

  @Prop()
  crm_last_synced!: Date;
}

export const ClientSchema = SchemaFactory.createForClass(Client);

// Compound indexes
ClientSchema.index({ rm_id: 1, tier: 1 });
ClientSchema.index({ rm_id: 1, last_interaction: 1 });
ClientSchema.index({ dob: 1 });
ClientSchema.index({ client_name: 'text' });
