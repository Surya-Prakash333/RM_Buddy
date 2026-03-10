import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseRepository } from './base.repository';
import { Client, ClientDocument } from '../models/client.model';

@Injectable()
export class ClientRepository extends BaseRepository<ClientDocument> {
  constructor(@InjectModel(Client.name) model: Model<ClientDocument>) {
    super(model, ClientRepository.name);
  }

  async findByRM(rmId: string, options?: { tier?: string; search?: string; page?: number; limit?: number }) {
    const filter: any = { rm_id: rmId };
    if (options?.tier) filter.tier = options.tier;
    if (options?.search) filter.$text = { $search: options.search };

    return this.findMany(filter, {
      page: options?.page,
      limit: options?.limit,
      sort: { total_aum: -1 },
    });
  }

  async findByClientId(clientId: string) {
    return this.findOne({ client_id: clientId });
  }

  async getClientCountByTier(rmId: string): Promise<Array<{ tier: string; count: number }>> {
    return this.aggregate([
      { $match: { rm_id: rmId } },
      { $group: { _id: '$tier', count: { $sum: 1 } } },
      { $project: { tier: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ]);
  }

  async getInactiveClients(rmId: string, daysSinceLastInteraction: number) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysSinceLastInteraction);

    return this.findMany({
      rm_id: rmId,
      last_interaction: { $lt: cutoffDate },
    });
  }
}
