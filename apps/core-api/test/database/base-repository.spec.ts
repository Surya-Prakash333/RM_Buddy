import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, Document, Model, Schema } from 'mongoose';
import { BaseRepository, PaginatedResult } from '../../src/database/repositories/base.repository';

interface TestDoc extends Document {
  name: string;
  category: string;
  value: number;
  rm_id: string;
}

const TestSchema = new Schema<TestDoc>(
  {
    name: { type: String, required: true },
    category: { type: String },
    value: { type: Number },
    rm_id: { type: String },
  },
  { timestamps: true },
);

class TestRepository extends BaseRepository<TestDoc> {
  constructor(model: Model<TestDoc>) {
    super(model, 'TestRepository');
  }
}

describe('BaseRepository', () => {
  jest.setTimeout(60000);

  let mongod: MongoMemoryServer;
  let connection: Connection;
  let TestModel: Model<TestDoc>;
  let repo: TestRepository;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    connection = mongoose.connection;
    TestModel = connection.model<TestDoc>('TestDoc', TestSchema);
    repo = new TestRepository(TestModel);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  afterEach(async () => {
    await TestModel.deleteMany({});
  });

  describe('create', () => {
    it('should create a document', async () => {
      const result = await repo.create({ name: 'Test Item', category: 'A', value: 100, rm_id: 'RM001' });

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Item');
      expect(result.category).toBe('A');
      expect(result.value).toBe(100);
      expect(result._id).toBeDefined();
    });
  });

  describe('findOne', () => {
    it('should find a single document by filter', async () => {
      await repo.create({ name: 'Find Me', category: 'B', value: 200, rm_id: 'RM001' });

      const result = await repo.findOne({ name: 'Find Me' });

      expect(result).toBeDefined();
      expect(result!.name).toBe('Find Me');
      expect(result!.value).toBe(200);
    });

    it('should return null when not found', async () => {
      const result = await repo.findOne({ name: 'Does Not Exist' });
      expect(result).toBeNull();
    });
  });

  describe('findMany', () => {
    beforeEach(async () => {
      for (let i = 0; i < 25; i++) {
        await repo.create({
          name: `Item ${i}`,
          category: i % 2 === 0 ? 'EVEN' : 'ODD',
          value: i * 10,
          rm_id: 'RM001',
        });
      }
    });

    it('should return paginated results (default page 1, limit 20)', async () => {
      const result: PaginatedResult<TestDoc> = await repo.findMany({});

      expect(result.items).toHaveLength(20);
      expect(result.total).toBe(25);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(2);
      expect(result.hasNext).toBe(true);
    });

    it('should return page 2', async () => {
      const result = await repo.findMany({}, { page: 2, limit: 20 });

      expect(result.items).toHaveLength(5);
      expect(result.page).toBe(2);
      expect(result.hasNext).toBe(false);
    });

    it('should filter results', async () => {
      const result = await repo.findMany({ category: 'EVEN' });

      expect(result.total).toBe(13);
      result.items.forEach(item => {
        expect(item.category).toBe('EVEN');
      });
    });

    it('should sort results', async () => {
      const result = await repo.findMany({}, { sort: { value: 1 }, limit: 5 });

      expect(result.items[0].value).toBe(0);
      expect(result.items[4].value).toBe(40);
    });

    it('should cap limit at 100', async () => {
      const result = await repo.findMany({}, { limit: 200 });
      expect(result.limit).toBe(100);
    });
  });

  describe('upsert', () => {
    it('should insert when document does not exist', async () => {
      const result = await repo.upsert(
        { name: 'Upserted' },
        { name: 'Upserted', category: 'NEW', value: 999, rm_id: 'RM001' },
      );

      expect(result).toBeDefined();
      expect(result.name).toBe('Upserted');
      expect(result.value).toBe(999);
    });

    it('should update when document exists', async () => {
      await repo.create({ name: 'Existing', category: 'OLD', value: 100, rm_id: 'RM001' });

      const result = await repo.upsert(
        { name: 'Existing' },
        { value: 500 } as Partial<TestDoc>,
      );

      expect(result.value).toBe(500);
    });
  });

  describe('updateOne', () => {
    it('should update a document and return the updated version', async () => {
      await repo.create({ name: 'To Update', category: 'A', value: 100, rm_id: 'RM001' });

      const result = await repo.updateOne(
        { name: 'To Update' },
        { $set: { value: 999 } },
      );

      expect(result).toBeDefined();
      expect(result!.value).toBe(999);
    });

    it('should return null when document not found', async () => {
      const result = await repo.updateOne(
        { name: 'NonExistent' },
        { $set: { value: 999 } },
      );

      expect(result).toBeNull();
    });
  });

  describe('deleteOne', () => {
    it('should delete a document and return true', async () => {
      await repo.create({ name: 'To Delete', category: 'A', value: 100, rm_id: 'RM001' });

      const deleted = await repo.deleteOne({ name: 'To Delete' });
      expect(deleted).toBe(true);

      const check = await repo.findOne({ name: 'To Delete' });
      expect(check).toBeNull();
    });

    it('should return false when document not found', async () => {
      const deleted = await repo.deleteOne({ name: 'NonExistent' });
      expect(deleted).toBe(false);
    });
  });

  describe('count', () => {
    it('should count documents matching filter', async () => {
      await repo.create({ name: 'A', category: 'X', value: 1, rm_id: 'RM001' });
      await repo.create({ name: 'B', category: 'X', value: 2, rm_id: 'RM001' });
      await repo.create({ name: 'C', category: 'Y', value: 3, rm_id: 'RM001' });

      const countX = await repo.count({ category: 'X' });
      expect(countX).toBe(2);

      const countAll = await repo.count({});
      expect(countAll).toBe(3);
    });
  });

  describe('aggregate', () => {
    it('should run an aggregation pipeline', async () => {
      await repo.create({ name: 'A', category: 'X', value: 10, rm_id: 'RM001' });
      await repo.create({ name: 'B', category: 'X', value: 20, rm_id: 'RM001' });
      await repo.create({ name: 'C', category: 'Y', value: 30, rm_id: 'RM001' });

      const result = await repo.aggregate<{ _id: string; total: number }>([
        { $group: { _id: '$category', total: { $sum: '$value' } } },
        { $sort: { _id: 1 } },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ _id: 'X', total: 30 });
      expect(result[1]).toEqual({ _id: 'Y', total: 30 });
    });
  });

  describe('exists', () => {
    it('should return true when document exists', async () => {
      await repo.create({ name: 'Exists', category: 'A', value: 1, rm_id: 'RM001' });
      const result = await repo.exists({ name: 'Exists' });
      expect(result).toBe(true);
    });

    it('should return false when document does not exist', async () => {
      const result = await repo.exists({ name: 'Nope' });
      expect(result).toBe(false);
    });
  });
});
