import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseRepository } from './base.repository';
import { AlertRecord, AlertDocument } from '../models/alert.model';

@Injectable()
export class AlertRepository extends BaseRepository<AlertDocument> {
  constructor(@InjectModel(AlertRecord.name) model: Model<AlertDocument>) {
    super(model, AlertRepository.name);
  }

  async findByRM(rmId: string, options?: { status?: string; priority?: string; page?: number; limit?: number }) {
    const filter: any = { rm_id: rmId };
    if (options?.status) filter.status = options.status;
    if (options?.priority) filter.severity = options.priority;

    return this.findMany(filter, {
      page: options?.page,
      limit: options?.limit,
      sort: { createdAt: -1 },
    });
  }

  async checkCooldown(rmId: string, alertType: string, clientId: string, cooldownHours: number): Promise<boolean> {
    const cooldownSince = new Date();
    cooldownSince.setHours(cooldownSince.getHours() - cooldownHours);

    return this.exists({
      rm_id: rmId,
      alert_type: alertType,
      client_id: clientId,
      createdAt: { $gte: cooldownSince },
    });
  }

  async acknowledge(alertId: string) {
    return this.updateOne(
      { alert_id: alertId },
      { $set: { status: 'ACKNOWLEDGED', acknowledged_at: new Date() } },
    );
  }

  async getAlertCountsByType(rmId: string): Promise<Array<{ type: string; count: number }>> {
    return this.aggregate([
      { $match: { rm_id: rmId, status: 'NEW' } },
      { $group: { _id: '$alert_type', count: { $sum: 1 } } },
      { $project: { type: '$_id', count: 1, _id: 0 } },
    ]);
  }
}
