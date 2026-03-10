import { Logger } from '@nestjs/common';
import { Model, FilterQuery, UpdateQuery, Document } from 'mongoose';

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
}

export abstract class BaseRepository<T extends Document> {
  protected readonly logger: Logger;

  constructor(
    protected readonly model: Model<T>,
    context?: string,
  ) {
    this.logger = new Logger(context || this.constructor.name);
  }

  async findOne(filter: FilterQuery<T>): Promise<T | null> {
    this.logger.debug(`findOne: ${JSON.stringify(filter)}`);
    return this.model.findOne(filter).lean().exec() as Promise<T | null>;
  }

  async findMany(
    filter: FilterQuery<T>,
    options?: { page?: number; limit?: number; sort?: Record<string, 1 | -1> },
  ): Promise<PaginatedResult<T>> {
    const page = options?.page || 1;
    const limit = Math.min(options?.limit || 20, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort(options?.sort || { createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.model.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items: items as T[],
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
    };
  }

  async upsert(filter: FilterQuery<T>, data: Partial<T>): Promise<T> {
    this.logger.debug(`upsert: ${JSON.stringify(filter)}`);
    return this.model
      .findOneAndUpdate(
        filter,
        { $set: { ...data, updated_at: new Date() } },
        { upsert: true, new: true, lean: true },
      )
      .exec() as Promise<T>;
  }

  async create(data: Partial<T>): Promise<T> {
    const doc = new this.model(data);
    const saved = await doc.save();
    return saved.toObject() as T;
  }

  async updateOne(filter: FilterQuery<T>, update: UpdateQuery<T>): Promise<T | null> {
    return this.model
      .findOneAndUpdate(filter, update, { new: true, lean: true })
      .exec() as Promise<T | null>;
  }

  async deleteOne(filter: FilterQuery<T>): Promise<boolean> {
    const result = await this.model.deleteOne(filter).exec();
    return result.deletedCount > 0;
  }

  async count(filter: FilterQuery<T>): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  async aggregate<R = any>(pipeline: any[]): Promise<R[]> {
    this.logger.debug(`aggregate: ${pipeline.length} stages`);
    return this.model.aggregate(pipeline).exec();
  }

  async exists(filter: FilterQuery<T>): Promise<boolean> {
    const doc = await this.model.exists(filter);
    return doc !== null;
  }
}
