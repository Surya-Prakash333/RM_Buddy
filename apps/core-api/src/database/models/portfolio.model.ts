import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PortfolioDocument = Portfolio & Document;

@Schema({ timestamps: true, collection: 'portfolios' })
export class Portfolio {
  @Prop({ required: true, unique: true, index: true })
  client_id!: string;

  @Prop({ required: true, index: true })
  rm_id!: string;

  @Prop({
    type: [{
      holding_id: String,
      account_id: String,
      asset_class: String,
      sub_product: String,
      instrument_name: String,
      isin: String,
      quantity: Number,
      avg_buy_price: Number,
      current_price: Number,
      current_value: Number,
      pnl: Number,
      pnl_pct: Number,
      weight_pct: Number,
    }],
  })
  holdings!: Array<{
    holding_id: string;
    account_id: string;
    asset_class: string;
    sub_product: string;
    instrument_name: string;
    isin: string;
    quantity: number;
    avg_buy_price: number;
    current_price: number;
    current_value: number;
    pnl: number;
    pnl_pct: number;
    weight_pct: number;
  }>;

  @Prop({ type: Object })
  summary!: {
    total_aum: number;
    by_asset_class: Record<string, number>;
    cash_balance: number;
    cash_pct: number;
    concentration: {
      max_stock_pct: number;
      max_stock_name: string;
      max_sector_pct: number;
      max_sector_name: string;
    };
  };

  @Prop({ type: Object })
  drawdown!: {
    peak_value: number;
    current_value: number;
    drawdown_pct: number;
    peak_date: Date;
  };

  @Prop()
  crm_last_synced!: Date;

  @Prop()
  snapshot_date!: Date;
}

export const PortfolioSchema = SchemaFactory.createForClass(Portfolio);

PortfolioSchema.index({ 'summary.cash_pct': 1 });
PortfolioSchema.index({ 'drawdown.drawdown_pct': 1 });
