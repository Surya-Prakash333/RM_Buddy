import * as fs from 'fs';
import * as path from 'path';

describe('Seed Data Script', () => {
  const seedPath = path.resolve(__dirname, '../../../../deployment/mongo/seed-data.js');
  const indexPath = path.resolve(__dirname, '../../../../deployment/mongo/init-indexes.js');
  let seedContent: string;
  let indexContent: string;

  beforeAll(() => {
    seedContent = fs.readFileSync(seedPath, 'utf-8');
    indexContent = fs.readFileSync(indexPath, 'utf-8');
  });

  describe('seed-data.js', () => {
    it('should exist and be readable', () => {
      expect(seedContent).toBeDefined();
      expect(seedContent.length).toBeGreaterThan(0);
    });

    it('should define 5 RMs', () => {
      const rmMatches = seedContent.match(/rm_id:\s*'RM\d{3}'/g);
      const bmMatches = seedContent.match(/rm_id:\s*'BM\d{3}'/g);
      const totalRMs = (rmMatches?.length || 0) + (bmMatches?.length || 0);
      expect(totalRMs).toBe(5);
    });

    it('should create 20-50 clients per RM', () => {
      expect(seedContent).toContain('randomBetween(20, 50)');
    });

    it('should use realistic Indian names', () => {
      expect(seedContent).toContain('Rajesh');
      expect(seedContent).toContain('Sunita');
      expect(seedContent).toContain('Malhotra');
      expect(seedContent).toContain('Joshi');
      expect(seedContent).toContain('Iyer');
    });

    it('should create varied tiers', () => {
      expect(seedContent).toContain('DIAMOND');
      expect(seedContent).toContain('BLACK');
      expect(seedContent).toContain('PLATINUM');
      expect(seedContent).toContain('GOLD');
      expect(seedContent).toContain('SILVER');
    });

    it('should seed clients with portfolios', () => {
      expect(seedContent).toContain('db.clients.insertOne');
      expect(seedContent).toContain('db.portfolios.insertOne');
    });

    it('should seed multiple asset classes', () => {
      expect(seedContent).toContain("'EQ'");
      expect(seedContent).toContain("'FI'");
      expect(seedContent).toContain("'MP'");
    });

    it('should clear existing data before seeding', () => {
      expect(seedContent).toContain('db.clients.deleteMany({})');
      expect(seedContent).toContain('db.portfolios.deleteMany({})');
    });

    it('should seed meetings', () => {
      expect(seedContent).toContain('db.meetings.insertOne');
    });
  });

  describe('init-indexes.js', () => {
    it('should exist and be readable', () => {
      expect(indexContent).toBeDefined();
      expect(indexContent.length).toBeGreaterThan(0);
    });

    it('should create indexes for all collections', () => {
      const collections = [
        'clients', 'portfolios', 'transactions', 'meetings',
        'leads', 'pipeline', 'alerts', 'alert_rules',
        'chat_history', 'rm_sessions', 'audit_trail',
      ];

      collections.forEach(col => {
        expect(indexContent).toContain(`db.${col}.createIndex`);
      });
    });

    it('should create TTL indexes', () => {
      expect(indexContent).toContain('expireAfterSeconds: 0');
      expect(indexContent).toContain('expireAfterSeconds: 604800');
    });

    it('should create unique indexes on ID fields', () => {
      expect(indexContent).toContain('{ unique: true }');
    });
  });
});
