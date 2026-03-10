import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseRepository } from './base.repository';
import { Portfolio, PortfolioDocument } from '../models/portfolio.model';

@Injectable()
export class PortfolioRepository extends BaseRepository<PortfolioDocument> {
  constructor(@InjectModel(Portfolio.name) model: Model<PortfolioDocument>) {
    super(model, PortfolioRepository.name);
  }

  async findByClientId(clientId: string) {
    return this.findOne({ client_id: clientId });
  }

  async findByRM(rmId: string) {
    return this.findMany({ rm_id: rmId }, { limit: 100 });
  }

  async getHighCashClients(rmId: string, cashPctThreshold: number) {
    return this.findMany({
      rm_id: rmId,
      'summary.cash_pct': { $gt: cashPctThreshold },
    });
  }

  async getConcentrationRiskClients(rmId: string, stockPctThreshold: number) {
    return this.findMany({
      rm_id: rmId,
      'summary.concentration.max_stock_pct': { $gt: stockPctThreshold },
    });
  }

  async getAUMByAssetClass(rmId: string): Promise<Array<{ asset_class: string; total: number }>> {
    return this.aggregate([
      { $match: { rm_id: rmId } },
      { $unwind: '$holdings' },
      { $group: { _id: '$holdings.asset_class', total: { $sum: '$holdings.current_value' } } },
      { $project: { asset_class: '$_id', total: 1, _id: 0 } },
      { $sort: { total: -1 } },
    ]);
  }
}
