import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PipelineDocument = Pipeline & Document;

@Schema({ timestamps: true, collection: 'pipeline' })
export class Pipeline {
  @Prop({ required: true, unique: true, index: true })
  pipeline_id!: string;

  @Prop({ required: true, index: true })
  rm_id!: string;

  @Prop()
  client_id!: string;

  @Prop()
  client_name!: string;

  @Prop()
  asset_class!: string;

  @Prop()
  sub_product!: string;

  @Prop()
  amount!: number;

  @Prop()
  status!: string;

  @Prop({ index: true })
  expected_close_date!: Date;

  @Prop()
  created_date!: Date;

  @Prop()
  last_updated!: Date;

  @Prop()
  probability!: number;

  @Prop()
  notes!: string;

  @Prop()
  crm_last_synced!: Date;
}

export const PipelineSchema = SchemaFactory.createForClass(Pipeline);

PipelineSchema.index({ rm_id: 1, status: 1 });
PipelineSchema.index({ rm_id: 1, expected_close_date: 1 });
