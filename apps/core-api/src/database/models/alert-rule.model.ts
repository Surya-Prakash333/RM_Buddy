import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AlertRuleDocument = AlertRuleRecord & Document;

@Schema({ timestamps: true, collection: 'alert_rules' })
export class AlertRuleRecord {
  @Prop({ required: true, unique: true, index: true })
  rule_id!: string;

  @Prop({ required: true })
  name!: string;

  @Prop()
  description!: string;

  @Prop()
  category!: string;

  @Prop()
  priority!: string;

  @Prop({ type: [{ field: String, operator: String, value: Object, description: String }] })
  conditions!: Array<{
    field: string;
    operator: string;
    value: any;
    description: string;
  }>;

  @Prop({ default: 168 })
  cooldown_hours!: number;

  @Prop({ type: Object })
  data_source!: {
    collection: string;
    query_fields: string[];
    aggregation?: any;
  };

  @Prop({ type: Object })
  notification!: {
    channels: string[];
    template: string;
    urgency: string;
  };

  @Prop({ default: true })
  enabled!: boolean;
}

export const AlertRuleSchema = SchemaFactory.createForClass(AlertRuleRecord);
