import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection } from 'mongoose';
import {
  ClientSchema,
  PortfolioSchema,
  TransactionSchema,
  MeetingSchema,
  LeadSchema,
  PipelineSchema,
  AlertSchema,
  AlertRuleSchema,
  ChatHistorySchema,
  RMSessionSchema,
  AuditSchema,
} from '../../src/database/models';

describe('MongoDB Models', () => {
  jest.setTimeout(60000);

  let mongod: MongoMemoryServer;
  let connection: Connection;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    connection = mongoose.connection;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  afterEach(async () => {
    const collections = connection.collections;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
  });

  const modelConfigs = [
    {
      name: 'Client',
      schema: ClientSchema,
      collection: 'clients',
      sampleData: {
        client_id: 'CLT-00001',
        rm_id: 'RM001',
        client_name: 'Rajesh Malhotra',
        email: 'rajesh@gmail.com',
        phone: '+919876543210',
        pan: 'ABCPD1234E',
        dob: new Date(1980, 5, 15),
        tier: 'DIAMOND',
        risk_profile: 'AGGRESSIVE',
        kyc_status: 'VALID',
        onboarding_date: new Date(2020, 1, 1),
        last_interaction: new Date(),
        total_aum: 50000000,
        total_revenue_ytd: 125000,
        accounts: [{
          account_id: 'ACC-CLT-00001',
          account_type: 'TRADING',
          status: 'ACTIVE',
          opening_date: new Date(2020, 1, 1),
          current_value: 50000000,
        }],
        tags: ['HNI', 'equity-focus'],
        crm_last_synced: new Date(),
      },
    },
    {
      name: 'Portfolio',
      schema: PortfolioSchema,
      collection: 'portfolios',
      sampleData: {
        client_id: 'CLT-00001',
        rm_id: 'RM001',
        holdings: [{
          holding_id: 'HLD-001',
          account_id: 'ACC-CLT-00001',
          asset_class: 'EQ',
          sub_product: 'Cash',
          instrument_name: 'Reliance',
          isin: 'INE002A01018',
          quantity: 100,
          avg_buy_price: 2400,
          current_price: 2600,
          current_value: 260000,
          pnl: 20000,
          pnl_pct: 8.33,
          weight_pct: 52,
        }],
        summary: {
          total_aum: 500000,
          by_asset_class: { EQ: 260000, FI: 240000 },
          cash_balance: 50000,
          cash_pct: 10,
          concentration: {
            max_stock_pct: 52,
            max_stock_name: 'Reliance',
            max_sector_pct: 35,
            max_sector_name: 'Energy',
          },
        },
        drawdown: {
          peak_value: 550000,
          current_value: 500000,
          drawdown_pct: 9.09,
          peak_date: new Date(2024, 0, 15),
        },
        crm_last_synced: new Date(),
        snapshot_date: new Date(),
      },
    },
    {
      name: 'Transaction',
      schema: TransactionSchema,
      collection: 'transactions',
      sampleData: {
        txn_id: 'TXN-00001',
        client_id: 'CLT-00001',
        rm_id: 'RM001',
        account_id: 'ACC-CLT-00001',
        asset_class: 'EQ',
        sub_product: 'Cash',
        instrument_name: 'TCS',
        txn_type: 'BUY',
        quantity: 50,
        price: 3500,
        amount: 175000,
        brokerage: 87.5,
        txn_date: new Date(),
        settlement_date: new Date(),
        status: 'COMPLETED',
        crm_last_synced: new Date(),
      },
    },
    {
      name: 'Meeting',
      schema: MeetingSchema,
      collection: 'meetings',
      sampleData: {
        meeting_id: 'MTG-00001',
        rm_id: 'RM001',
        client_id: 'CLT-00001',
        client_name: 'Rajesh Malhotra',
        client_tier: 'DIAMOND',
        meeting_type: 'in_person',
        status: 'scheduled',
        scheduled_date: new Date(),
        scheduled_time: '10:00',
        duration_minutes: 60,
        agenda: 'Portfolio Review',
        notes: '',
        outcome: '',
        location: 'Office',
        priority: 'HIGH',
        crm_last_synced: new Date(),
      },
    },
    {
      name: 'Lead',
      schema: LeadSchema,
      collection: 'leads',
      sampleData: {
        lead_id: 'LEAD-00001',
        rm_id: 'RM001',
        client_id: 'CLT-00001',
        client_name: 'Rajesh Malhotra',
        category: 'hot',
        asset_class: 'EQ',
        estimated_amount: 5000000,
        source: 'referral',
        status: 'NEW',
        created_date: new Date(),
        expiry_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        last_contact: new Date(),
        notes: 'Interested in equity portfolio',
        crm_last_synced: new Date(),
      },
    },
    {
      name: 'Pipeline',
      schema: PipelineSchema,
      collection: 'pipeline',
      sampleData: {
        pipeline_id: 'PIP-00001',
        rm_id: 'RM001',
        client_id: 'CLT-00001',
        client_name: 'Rajesh Malhotra',
        asset_class: 'EQ',
        sub_product: 'PMS',
        amount: 10000000,
        status: 'PROPOSAL',
        expected_close_date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        created_date: new Date(),
        last_updated: new Date(),
        probability: 70,
        notes: 'High probability conversion',
        crm_last_synced: new Date(),
      },
    },
    {
      name: 'Alert',
      schema: AlertSchema,
      collection: 'alerts',
      sampleData: {
        alert_id: 'ALR-00001',
        alert_type: 'idle_cash',
        rm_id: 'RM001',
        client_id: 'CLT-00001',
        client_name: 'Rajesh Malhotra',
        client_tier: 'DIAMOND',
        severity: 'HIGH',
        status: 'NEW',
        title: 'Idle Cash Alert',
        message: 'Client has Rs. 50L idle cash',
        data: { cash_balance: 5000000, cash_pct: 15 },
        action_suggestion: 'Suggest FD or debt fund',
        delivered_at: new Date(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        rule_id: 'RULE-001',
      },
    },
    {
      name: 'AlertRule',
      schema: AlertRuleSchema,
      collection: 'alert_rules',
      sampleData: {
        rule_id: 'RULE-001',
        name: 'Idle Cash Detection',
        description: 'Detect clients with high idle cash',
        category: 'PORTFOLIO',
        priority: 'HIGH',
        conditions: [{
          field: 'summary.cash_pct',
          operator: 'gt',
          value: 10,
          description: 'Cash > 10% of AUM',
        }],
        cooldown_hours: 168,
        data_source: {
          collection: 'portfolios',
          query_fields: ['summary.cash_pct', 'summary.cash_balance'],
        },
        notification: {
          channels: ['push'],
          template: 'idle_cash_alert',
          urgency: 'batched',
        },
        enabled: true,
      },
    },
    {
      name: 'ChatHistory',
      schema: ChatHistorySchema,
      collection: 'chat_history',
      sampleData: {
        session_id: 'SESS-00001',
        rm_id: 'RM001',
        messages: [{
          message_id: 'MSG-001',
          role: 'user',
          content: 'Show my top clients',
          widgets: [],
          agent_id: 'orchestrator',
          model_used: 'claude-sonnet-4-20250514',
          tokens_used: 150,
          timestamp: new Date(),
        }],
        started_at: new Date(),
        last_message_at: new Date(),
        message_count: 1,
        total_tokens: 150,
        total_cost: 0.001,
      },
    },
    {
      name: 'RMSession',
      schema: RMSessionSchema,
      collection: 'rm_sessions',
      sampleData: {
        session_id: 'AUTH-SESS-001',
        rm_id: 'RM001',
        rm_name: 'Arun Sharma',
        rm_code: 'NUV-RM-001',
        rm_email: 'arun.sharma@nuvama.com',
        rm_branch: 'Mumbai - BKC',
        rm_region: 'West',
        role: 'RM',
        token: 'jwt-token-placeholder',
        expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000),
        last_active: new Date(),
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
        is_active: true,
      },
    },
    {
      name: 'AuditTrail',
      schema: AuditSchema,
      collection: 'audit_trail',
      sampleData: {
        rm_id: 'RM001',
        action: 'VIEW_CLIENT',
        resource_type: 'client',
        resource_id: 'CLT-00001',
        request: { method: 'GET', path: '/api/clients/CLT-00001' },
        response: { status: 200 },
        status: 'success',
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
        duration_ms: 45,
      },
    },
  ];

  describe('Document creation', () => {
    modelConfigs.forEach(({ name, schema, collection, sampleData }) => {
      it(`should create a ${name} document`, async () => {
        const Model = connection.model(name, schema, collection);
        const doc = new Model(sampleData);
        const saved = await doc.save();

        expect(saved._id).toBeDefined();
        expect(saved.toObject()).toMatchObject(sampleData);
      });
    });
  });

  describe('Indexes', () => {
    it('should create Client indexes correctly', async () => {
      const Model = connection.model('ClientIdx', ClientSchema, 'clients_idx');
      await Model.createIndexes();
      const indexes = await Model.collection.indexes();
      const indexKeys = indexes.map(idx => JSON.stringify(idx.key));

      expect(indexKeys).toContain(JSON.stringify({ client_id: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1, tier: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1, last_interaction: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ dob: 1 }));

      const textIndex = indexes.find(idx => Object.values(idx.key).includes('text'));
      expect(textIndex).toBeDefined();

      const uniqueIndex = indexes.find(idx => JSON.stringify(idx.key) === JSON.stringify({ client_id: 1 }));
      expect(uniqueIndex?.unique).toBe(true);
    });

    it('should create Portfolio indexes correctly', async () => {
      const Model = connection.model('PortfolioIdx', PortfolioSchema, 'portfolios_idx');
      await Model.createIndexes();
      const indexes = await Model.collection.indexes();
      const indexKeys = indexes.map(idx => JSON.stringify(idx.key));

      expect(indexKeys).toContain(JSON.stringify({ client_id: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ 'summary.cash_pct': 1 }));
      expect(indexKeys).toContain(JSON.stringify({ 'drawdown.drawdown_pct': 1 }));
    });

    it('should create Transaction indexes correctly', async () => {
      const Model = connection.model('TransactionIdx', TransactionSchema, 'transactions_idx');
      await Model.createIndexes();
      const indexes = await Model.collection.indexes();
      const indexKeys = indexes.map(idx => JSON.stringify(idx.key));

      expect(indexKeys).toContain(JSON.stringify({ txn_id: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1, txn_date: -1 }));
      expect(indexKeys).toContain(JSON.stringify({ client_id: 1, txn_date: -1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1, asset_class: 1, txn_date: -1 }));
    });

    it('should create Meeting indexes correctly', async () => {
      const Model = connection.model('MeetingIdx', MeetingSchema, 'meetings_idx');
      await Model.createIndexes();
      const indexes = await Model.collection.indexes();
      const indexKeys = indexes.map(idx => JSON.stringify(idx.key));

      expect(indexKeys).toContain(JSON.stringify({ meeting_id: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1, scheduled_date: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1, status: 1 }));
    });

    it('should create Lead indexes correctly', async () => {
      const Model = connection.model('LeadIdx', LeadSchema, 'leads_idx');
      await Model.createIndexes();
      const indexes = await Model.collection.indexes();
      const indexKeys = indexes.map(idx => JSON.stringify(idx.key));

      expect(indexKeys).toContain(JSON.stringify({ lead_id: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1, status: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1, expiry_date: 1 }));
    });

    it('should create Pipeline indexes correctly', async () => {
      const Model = connection.model('PipelineIdx', PipelineSchema, 'pipeline_idx');
      await Model.createIndexes();
      const indexes = await Model.collection.indexes();
      const indexKeys = indexes.map(idx => JSON.stringify(idx.key));

      expect(indexKeys).toContain(JSON.stringify({ pipeline_id: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1, status: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1, expected_close_date: 1 }));
    });

    it('should create Alert indexes with TTL on expires_at', async () => {
      const Model = connection.model('AlertIdx', AlertSchema, 'alerts_idx');
      await Model.createIndexes();
      const indexes = await Model.collection.indexes();
      const indexKeys = indexes.map(idx => JSON.stringify(idx.key));

      expect(indexKeys).toContain(JSON.stringify({ alert_id: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1, status: 1, createdAt: -1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1, alert_type: 1, client_id: 1 }));

      const ttlIndex = indexes.find(idx => JSON.stringify(idx.key) === JSON.stringify({ expires_at: 1 }));
      expect(ttlIndex).toBeDefined();
      expect(ttlIndex?.expireAfterSeconds).toBe(0);
    });

    it('should create ChatHistory indexes with TTL on last_message_at', async () => {
      const Model = connection.model('ChatHistoryIdx', ChatHistorySchema, 'chat_history_idx');
      await Model.createIndexes();
      const indexes = await Model.collection.indexes();
      const indexKeys = indexes.map(idx => JSON.stringify(idx.key));

      expect(indexKeys).toContain(JSON.stringify({ session_id: 1 }));
      expect(indexKeys).toContain(JSON.stringify({ rm_id: 1, last_message_at: -1 }));

      const ttlIndex = indexes.find(idx => JSON.stringify(idx.key) === JSON.stringify({ last_message_at: 1 }));
      expect(ttlIndex).toBeDefined();
      expect(ttlIndex?.expireAfterSeconds).toBe(604800);
    });

    it('should create RMSession indexes with TTL on expires_at', async () => {
      const Model = connection.model('RMSessionIdx', RMSessionSchema, 'rm_sessions_idx');
      await Model.createIndexes();
      const indexes = await Model.collection.indexes();

      const ttlIndex = indexes.find(idx => JSON.stringify(idx.key) === JSON.stringify({ expires_at: 1 }));
      expect(ttlIndex).toBeDefined();
      expect(ttlIndex?.expireAfterSeconds).toBe(0);
    });
  });

  describe('TTL behavior', () => {
    it('should set TTL field on Alert expires_at', async () => {
      const Model = connection.model('AlertTTL', AlertSchema, 'alerts_ttl');
      await Model.createIndexes();

      const pastDate = new Date(Date.now() - 1000);
      const doc = new Model({
        alert_id: 'ALR-TTL-001',
        alert_type: 'idle_cash',
        rm_id: 'RM001',
        client_id: 'CLT-00001',
        severity: 'HIGH',
        status: 'NEW',
        title: 'Test TTL',
        message: 'Test',
        expires_at: pastDate,
      });
      const saved = await doc.save();
      expect(saved.expires_at).toEqual(pastDate);

      const indexes = await Model.collection.indexes();
      const ttlIndex = indexes.find(idx => JSON.stringify(idx.key) === JSON.stringify({ expires_at: 1 }));
      expect(ttlIndex?.expireAfterSeconds).toBe(0);
    });

    it('should set TTL field on RMSession expires_at', async () => {
      const Model = connection.model('RMSessionTTL', RMSessionSchema, 'rm_sessions_ttl');
      await Model.createIndexes();

      const futureDate = new Date(Date.now() + 60000);
      const doc = new Model({
        session_id: 'TTL-SESS-001',
        rm_id: 'RM001',
        expires_at: futureDate,
      });
      const saved = await doc.save();
      expect(saved.expires_at).toEqual(futureDate);

      const indexes = await Model.collection.indexes();
      const ttlIndex = indexes.find(idx => JSON.stringify(idx.key) === JSON.stringify({ expires_at: 1 }));
      expect(ttlIndex?.expireAfterSeconds).toBe(0);
    });
  });
});
