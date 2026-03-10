import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseRepository } from './base.repository';
import { Meeting, MeetingDocument } from '../models/meeting.model';

@Injectable()
export class MeetingRepository extends BaseRepository<MeetingDocument> {
  constructor(@InjectModel(Meeting.name) model: Model<MeetingDocument>) {
    super(model, MeetingRepository.name);
  }

  async findTodayMeetings(rmId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.findMany({
      rm_id: rmId,
      scheduled_date: { $gte: today, $lt: tomorrow },
      status: { $in: ['scheduled'] },
    }, { sort: { scheduled_date: 1 } });
  }

  async findUpcoming(rmId: string, days: number = 7) {
    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + days);

    return this.findMany({
      rm_id: rmId,
      scheduled_date: { $gte: now, $lte: future },
      status: 'scheduled',
    }, { sort: { scheduled_date: 1 } });
  }
}
