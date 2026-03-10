import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TransactionDocument = Transaction & Document;

@Schema({ timestamps: true, collection: 'transactions' })
export class Transaction {
  @Prop({ required: true, unique: true, index: true })
  txn_id!: string;

  @Prop({ required: true, index: true })
  client_id!: string;

  @Prop({ required: true, index: true })
  rm_id!: string;

  @Prop()
  account_id!: string;

  @Prop()
  asset_class!: string;

  @Prop()
  sub_product!: string;

  @Prop()
  instrument_name!: string;

  @Prop()
  txn_type!: string;

  @Prop()
  quantity!: number;

  @Prop()
  price!: number;

  @Prop()
  amount!: number;

  @Prop()
  brokerage!: number;

  @Prop({ index: true })
  txn_date!: Date;

  @Prop()
  settlement_date!: Date;

  @Prop()
  status!: string;

  @Prop()
  crm_last_synced!: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

TransactionSchema.index({ rm_id: 1, txn_date: -1 });
TransactionSchema.index({ client_id: 1, txn_date: -1 });
TransactionSchema.index({ rm_id: 1, asset_class: 1, txn_date: -1 });
