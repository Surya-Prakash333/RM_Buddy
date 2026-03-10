import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Public interface contracts
// These interfaces are STABLE — when real CRM API docs arrive, only the HTTP
// implementation inside CrmApiClient changes; all callers stay untouched.
// ---------------------------------------------------------------------------

export interface CRMClientAccount {
  account_id: string;
  account_type: string;
  status: string;
  opening_date: string; // ISO date string
  current_value: number;
}

export interface CRMClient {
  client_id: string;
  rm_id: string;
  client_name: string;
  email: string;
  phone: string;
  pan: string;
  dob: string; // ISO date string
  tier: string;
  risk_profile: string;
  kyc_status: string;
  onboarding_date: string; // ISO date string
  last_interaction: string; // ISO date string
  total_aum: number;
  total_revenue_ytd: number;
  accounts: CRMClientAccount[];
  tags: string[];
}

export interface CRMPortfolio {
  portfolio_id: string;
  client_id: string;
  rm_id: string;
  total_aum: number;
  holdings: Array<{
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
  snapshot_date: string; // ISO date string
}

export interface CRMMeeting {
  meeting_id: string;
  rm_id: string;
  client_id: string;
  client_name: string;
  client_tier: string;
  meeting_type: string;
  status: string;
  scheduled_date: string; // ISO date string
  scheduled_time: string;
  duration_minutes: number;
  agenda: string;
  notes: string;
  outcome: string;
  location: string;
  priority: string;
}

export interface CRMLead {
  lead_id: string;
  rm_id: string;
  client_id: string;
  client_name: string;
  category: string;
  asset_class: string;
  estimated_amount: number;
  source: string;
  status: string;
  created_date: string; // ISO date string
  expiry_date: string; // ISO date string
  last_contact: string; // ISO date string
  notes: string;
}

export interface CRMPipelineItem {
  pipeline_id: string;
  rm_id: string;
  client_id: string;
  client_name: string;
  asset_class: string;
  sub_product: string;
  amount: number;
  status: string;
  expected_close_date: string; // ISO date string
  created_date: string; // ISO date string
  last_updated: string; // ISO date string
  probability: number;
  notes: string;
}

export interface CRMSyncPage<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Mock data constants
// Realistic Indian wealth management data — mirrors seed-data.js
// ---------------------------------------------------------------------------

const MOCK_RM_IDS = ['RM001', 'RM002', 'RM003', 'RM004', 'RM005'];

const MOCK_CLIENTS_POOL: Omit<CRMClient, 'rm_id'>[] = [
  {
    client_id: 'CL001',
    client_name: 'Rajesh Kumar Sharma',
    email: 'rajesh.sharma@gmail.com',
    phone: '+91-9876543210',
    pan: 'ABCPS1234A',
    dob: '1968-03-15',
    tier: 'Platinum',
    risk_profile: 'Moderate',
    kyc_status: 'verified',
    onboarding_date: '2018-06-01',
    last_interaction: '2024-01-10',
    total_aum: 52000000,
    total_revenue_ytd: 780000,
    accounts: [
      { account_id: 'ACC001', account_type: 'Demat', status: 'active', opening_date: '2018-06-01', current_value: 32000000 },
      { account_id: 'ACC002', account_type: 'MF', status: 'active', opening_date: '2019-01-15', current_value: 20000000 },
    ],
    tags: ['high-value', 'long-term', 'equity-focused'],
  },
  {
    client_id: 'CL002',
    client_name: 'Priya Venkataraman',
    email: 'priya.venkat@outlook.com',
    phone: '+91-9876543211',
    pan: 'BCQPV2345B',
    dob: '1975-07-22',
    tier: 'Gold',
    risk_profile: 'Conservative',
    kyc_status: 'verified',
    onboarding_date: '2020-03-10',
    last_interaction: '2024-01-08',
    total_aum: 18500000,
    total_revenue_ytd: 220000,
    accounts: [
      { account_id: 'ACC003', account_type: 'FD', status: 'active', opening_date: '2020-03-10', current_value: 10000000 },
      { account_id: 'ACC004', account_type: 'Bonds', status: 'active', opening_date: '2021-06-20', current_value: 8500000 },
    ],
    tags: ['debt-focused', 'retirement-planning'],
  },
  {
    client_id: 'CL003',
    client_name: 'Amit Patel',
    email: 'amit.patel@yahoo.com',
    phone: '+91-9876543212',
    pan: 'CDRPA3456C',
    dob: '1980-11-05',
    tier: 'Platinum',
    risk_profile: 'Aggressive',
    kyc_status: 'verified',
    onboarding_date: '2017-09-15',
    last_interaction: '2024-01-12',
    total_aum: 75000000,
    total_revenue_ytd: 1200000,
    accounts: [
      { account_id: 'ACC005', account_type: 'Demat', status: 'active', opening_date: '2017-09-15', current_value: 50000000 },
      { account_id: 'ACC006', account_type: 'PMS', status: 'active', opening_date: '2019-04-01', current_value: 25000000 },
    ],
    tags: ['ultra-hni', 'pms-client', 'equity-focused'],
  },
  {
    client_id: 'CL004',
    client_name: 'Sunita Mehrotra',
    email: 'sunita.mehrotra@gmail.com',
    phone: '+91-9876543213',
    pan: 'DESPM4567D',
    dob: '1965-02-18',
    tier: 'Gold',
    risk_profile: 'Moderate',
    kyc_status: 'verified',
    onboarding_date: '2019-11-20',
    last_interaction: '2023-12-28',
    total_aum: 22000000,
    total_revenue_ytd: 310000,
    accounts: [
      { account_id: 'ACC007', account_type: 'MF', status: 'active', opening_date: '2019-11-20', current_value: 14000000 },
      { account_id: 'ACC008', account_type: 'FD', status: 'active', opening_date: '2020-08-15', current_value: 8000000 },
    ],
    tags: ['balanced', 'nri-referral'],
  },
  {
    client_id: 'CL005',
    client_name: 'Vikram Singh Rathore',
    email: 'vikram.rathore@business.com',
    phone: '+91-9876543214',
    pan: 'EFTVS5678E',
    dob: '1972-08-30',
    tier: 'Platinum',
    risk_profile: 'Moderate-Aggressive',
    kyc_status: 'verified',
    onboarding_date: '2016-04-05',
    last_interaction: '2024-01-15',
    total_aum: 95000000,
    total_revenue_ytd: 1650000,
    accounts: [
      { account_id: 'ACC009', account_type: 'Demat', status: 'active', opening_date: '2016-04-05', current_value: 60000000 },
      { account_id: 'ACC010', account_type: 'AIF', status: 'active', opening_date: '2021-01-10', current_value: 35000000 },
    ],
    tags: ['ultra-hni', 'aif-client', 'business-owner'],
  },
  {
    client_id: 'CL006',
    client_name: 'Kavitha Nair',
    email: 'kavitha.nair@techcorp.in',
    phone: '+91-9876543215',
    pan: 'FGUKN6789F',
    dob: '1985-05-12',
    tier: 'Silver',
    risk_profile: 'Aggressive',
    kyc_status: 'verified',
    onboarding_date: '2022-02-14',
    last_interaction: '2024-01-05',
    total_aum: 8500000,
    total_revenue_ytd: 95000,
    accounts: [
      { account_id: 'ACC011', account_type: 'Demat', status: 'active', opening_date: '2022-02-14', current_value: 5000000 },
      { account_id: 'ACC012', account_type: 'MF', status: 'active', opening_date: '2022-06-01', current_value: 3500000 },
    ],
    tags: ['tech-professional', 'sip-active', 'growth-oriented'],
  },
  {
    client_id: 'CL007',
    client_name: 'Suresh Iyer',
    email: 'suresh.iyer@finance.com',
    phone: '+91-9876543216',
    pan: 'GHVLI7890G',
    dob: '1970-12-01',
    tier: 'Gold',
    risk_profile: 'Conservative',
    kyc_status: 'pending',
    onboarding_date: '2021-07-30',
    last_interaction: '2023-11-20',
    total_aum: 31000000,
    total_revenue_ytd: 420000,
    accounts: [
      { account_id: 'ACC013', account_type: 'Bonds', status: 'active', opening_date: '2021-07-30', current_value: 20000000 },
      { account_id: 'ACC014', account_type: 'FD', status: 'active', opening_date: '2022-03-15', current_value: 11000000 },
    ],
    tags: ['debt-focused', 'kyc-pending', 'income-focused'],
  },
  {
    client_id: 'CL008',
    client_name: 'Ananya Krishnamurthy',
    email: 'ananya.k@startup.io',
    phone: '+91-9876543217',
    pan: 'HIWMA8901H',
    dob: '1990-04-25',
    tier: 'Silver',
    risk_profile: 'Aggressive',
    kyc_status: 'verified',
    onboarding_date: '2023-01-10',
    last_interaction: '2024-01-14',
    total_aum: 5200000,
    total_revenue_ytd: 58000,
    accounts: [
      { account_id: 'ACC015', account_type: 'Demat', status: 'active', opening_date: '2023-01-10', current_value: 5200000 },
    ],
    tags: ['new-client', 'startup-founder', 'equity-focused'],
  },
  {
    client_id: 'CL009',
    client_name: 'Manish Agarwal',
    email: 'manish.agarwal@trading.co',
    phone: '+91-9876543218',
    pan: 'IJXNA9012I',
    dob: '1977-09-08',
    tier: 'Platinum',
    risk_profile: 'Aggressive',
    kyc_status: 'verified',
    onboarding_date: '2015-11-20',
    last_interaction: '2024-01-16',
    total_aum: 120000000,
    total_revenue_ytd: 2100000,
    accounts: [
      { account_id: 'ACC016', account_type: 'Demat', status: 'active', opening_date: '2015-11-20', current_value: 80000000 },
      { account_id: 'ACC017', account_type: 'PMS', status: 'active', opening_date: '2018-03-01', current_value: 40000000 },
    ],
    tags: ['ultra-hni', 'trader', 'derivatives'],
  },
  {
    client_id: 'CL010',
    client_name: 'Deepa Chandrasekhar',
    email: 'deepa.cs@healthcare.in',
    phone: '+91-9876543219',
    pan: 'JKYOB0123J',
    dob: '1983-06-14',
    tier: 'Gold',
    risk_profile: 'Moderate',
    kyc_status: 'verified',
    onboarding_date: '2020-09-01',
    last_interaction: '2024-01-09',
    total_aum: 25000000,
    total_revenue_ytd: 340000,
    accounts: [
      { account_id: 'ACC018', account_type: 'MF', status: 'active', opening_date: '2020-09-01', current_value: 15000000 },
      { account_id: 'ACC019', account_type: 'Demat', status: 'active', opening_date: '2021-02-10', current_value: 10000000 },
    ],
    tags: ['doctor', 'balanced', 'goal-based'],
  },
];

/**
 * Assigns mock clients to an RM from the pool.
 * Each RM gets a consistent slice of 5–10 clients based on RM ID hash.
 */
function getMockClientsForRM(rmId: string): CRMClient[] {
  const rmIndex = MOCK_RM_IDS.indexOf(rmId);
  const offset = rmIndex === -1 ? 0 : (rmIndex * 3) % MOCK_CLIENTS_POOL.length;
  const count = 5 + (rmIndex === -1 ? 0 : rmIndex % 3); // 5 to 7 clients per RM
  const slice: CRMClient[] = [];

  for (let i = 0; i < count; i++) {
    const poolEntry = MOCK_CLIENTS_POOL[(offset + i) % MOCK_CLIENTS_POOL.length];
    slice.push({ ...poolEntry, rm_id: rmId });
  }
  return slice;
}

function paginate<T>(items: T[], page: number, limit: number): CRMSyncPage<T> {
  const start = (page - 1) * limit;
  const data = items.slice(start, start + limit);
  return {
    data,
    page,
    limit,
    total: items.length,
    hasMore: start + limit < items.length,
  };
}

// ---------------------------------------------------------------------------
// CrmApiClient
// ---------------------------------------------------------------------------

/**
 * HTTP client for the Nuvama CRM API.
 *
 * MOCK implementation — the BASE_URL is read from CRM_API_BASE_URL env var.
 * When the value is 'mock' (or absent), all methods return deterministic mock
 * data so the rest of the pipeline can be developed and tested independently.
 *
 * When real CRM API docs arrive:
 *   1. Set CRM_API_BASE_URL to the real base URL.
 *   2. Replace the private _mockXxx() helpers with actual fetch/axios calls.
 *   3. Map the CRM response shape to the exported interfaces above.
 *   4. All callers (CrmSyncService) remain unchanged.
 */
@Injectable()
export class CrmApiClient {
  private readonly logger = new Logger(CrmApiClient.name);
  private readonly baseUrl: string;
  private readonly isMock: boolean;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('CRM_API_BASE_URL', 'mock');
    this.isMock = !this.baseUrl || this.baseUrl === 'mock';

    if (this.isMock) {
      this.logger.warn(
        'CRM_API_BASE_URL is not set or is "mock" — using mock CRM data. ' +
        'Set CRM_API_BASE_URL to a real URL to enable live CRM integration.',
      );
    } else {
      this.logger.log(`CRM API base URL: ${this.baseUrl}`);
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async getClients(
    rmId: string,
    page: number = 1,
    limit: number = 100,
  ): Promise<CRMSyncPage<CRMClient>> {
    if (this.isMock) {
      return this._mockGetClients(rmId, page, limit);
    }
    // TODO: replace with real HTTP call when CRM API docs are available
    // GET ${this.baseUrl}/api/v1/clients?rm_id={rmId}&page={page}&limit={limit}
    throw new Error('Live CRM API not yet implemented — set CRM_API_BASE_URL=mock for development');
  }

  async getPortfolios(
    rmId: string,
    page: number = 1,
  ): Promise<CRMSyncPage<CRMPortfolio>> {
    if (this.isMock) {
      return this._mockGetPortfolios(rmId, page);
    }
    // TODO: GET ${this.baseUrl}/api/v1/portfolios?rm_id={rmId}&page={page}
    throw new Error('Live CRM API not yet implemented');
  }

  async getMeetings(
    rmId: string,
    changedSince?: Date,
  ): Promise<CRMSyncPage<CRMMeeting>> {
    if (this.isMock) {
      return this._mockGetMeetings(rmId, changedSince);
    }
    // TODO: GET ${this.baseUrl}/api/v1/meetings?rm_id={rmId}&changed_since={iso}
    throw new Error('Live CRM API not yet implemented');
  }

  async getLeads(
    rmId: string,
    changedSince?: Date,
  ): Promise<CRMSyncPage<CRMLead>> {
    if (this.isMock) {
      return this._mockGetLeads(rmId, changedSince);
    }
    // TODO: GET ${this.baseUrl}/api/v1/leads?rm_id={rmId}&changed_since={iso}
    throw new Error('Live CRM API not yet implemented');
  }

  async getPipeline(
    rmId: string,
  ): Promise<CRMSyncPage<CRMPipelineItem>> {
    if (this.isMock) {
      return this._mockGetPipeline(rmId);
    }
    // TODO: GET ${this.baseUrl}/api/v1/pipeline?rm_id={rmId}
    throw new Error('Live CRM API not yet implemented');
  }

  async createMeeting(
    data: Record<string, unknown>,
  ): Promise<{ success: boolean; meeting_id: string }> {
    if (this.isMock) {
      const meetingId = `MTG-MOCK-${Date.now()}`;
      this.logger.debug(`Mock createMeeting → ${meetingId}`);
      return { success: true, meeting_id: meetingId };
    }
    // TODO: POST ${this.baseUrl}/api/v1/meetings  body: data
    throw new Error('Live CRM API not yet implemented');
  }

  async updateLead(
    leadId: string,
    data: Record<string, unknown>,
  ): Promise<{ success: boolean }> {
    if (this.isMock) {
      this.logger.debug(`Mock updateLead → ${leadId}`);
      return { success: true };
    }
    // TODO: PATCH ${this.baseUrl}/api/v1/leads/{leadId}  body: data
    throw new Error('Live CRM API not yet implemented');
  }

  // --------------------------------------------------------------------------
  // Mock implementations
  // --------------------------------------------------------------------------

  private _mockGetClients(
    rmId: string,
    page: number,
    limit: number,
  ): CRMSyncPage<CRMClient> {
    const clients = getMockClientsForRM(rmId);
    return paginate(clients, page, limit);
  }

  private _mockGetPortfolios(
    rmId: string,
    page: number,
  ): CRMSyncPage<CRMPortfolio> {
    const clients = getMockClientsForRM(rmId);
    const portfolios: CRMPortfolio[] = clients.map((c) => ({
      portfolio_id: `PF-${c.client_id}`,
      client_id: c.client_id,
      rm_id: rmId,
      total_aum: c.total_aum,
      holdings: [
        {
          holding_id: `HLD-${c.client_id}-001`,
          account_id: c.accounts[0]?.account_id ?? 'ACC000',
          asset_class: 'Equity',
          sub_product: 'Large Cap',
          instrument_name: 'Reliance Industries Ltd',
          isin: 'INE002A01018',
          quantity: Math.floor(c.total_aum / 2500 / 1000),
          avg_buy_price: 2200,
          current_price: 2500,
          current_value: Math.floor(c.total_aum * 0.4),
          pnl: Math.floor(c.total_aum * 0.04),
          pnl_pct: 13.6,
          weight_pct: 40,
        },
        {
          holding_id: `HLD-${c.client_id}-002`,
          account_id: c.accounts[0]?.account_id ?? 'ACC000',
          asset_class: 'Debt',
          sub_product: 'Liquid Fund',
          instrument_name: 'HDFC Liquid Fund',
          isin: 'INF179K01XW8',
          quantity: Math.floor(c.total_aum * 0.3 / 1000),
          avg_buy_price: 1000,
          current_price: 1000,
          current_value: Math.floor(c.total_aum * 0.3),
          pnl: 0,
          pnl_pct: 0,
          weight_pct: 30,
        },
      ],
      snapshot_date: new Date().toISOString(),
    }));
    return paginate(portfolios, page, 100);
  }

  private _mockGetMeetings(
    rmId: string,
    _changedSince?: Date,
  ): CRMSyncPage<CRMMeeting> {
    const clients = getMockClientsForRM(rmId);
    const meetings: CRMMeeting[] = clients.slice(0, 3).map((c, i) => ({
      meeting_id: `MTG-${rmId}-${c.client_id}`,
      rm_id: rmId,
      client_id: c.client_id,
      client_name: c.client_name,
      client_tier: c.tier,
      meeting_type: i % 2 === 0 ? 'Portfolio Review' : 'Financial Planning',
      status: i === 0 ? 'scheduled' : 'completed',
      scheduled_date: new Date(Date.now() + (i - 1) * 86400000).toISOString(),
      scheduled_time: '10:30',
      duration_minutes: 60,
      agenda: `Quarterly review for ${c.client_name}`,
      notes: '',
      outcome: i !== 0 ? 'Discussed rebalancing options' : '',
      location: 'Office - Mumbai',
      priority: c.tier === 'Platinum' ? 'High' : 'Medium',
    }));
    return { data: meetings, page: 1, limit: 100, total: meetings.length, hasMore: false };
  }

  private _mockGetLeads(
    rmId: string,
    _changedSince?: Date,
  ): CRMSyncPage<CRMLead> {
    const clients = getMockClientsForRM(rmId);
    const leads: CRMLead[] = clients.slice(0, 2).map((c, i) => ({
      lead_id: `LEAD-${rmId}-${c.client_id}`,
      rm_id: rmId,
      client_id: c.client_id,
      client_name: c.client_name,
      category: i % 2 === 0 ? 'Cross-sell' : 'Upsell',
      asset_class: i % 2 === 0 ? 'Equity' : 'Debt',
      estimated_amount: 5000000 + i * 1000000,
      source: 'CRM',
      status: 'open',
      created_date: new Date(Date.now() - 30 * 86400000).toISOString(),
      expiry_date: new Date(Date.now() + 60 * 86400000).toISOString(),
      last_contact: new Date(Date.now() - 7 * 86400000).toISOString(),
      notes: `Follow up on ${c.client_name}'s interest in additional investment`,
    }));
    return { data: leads, page: 1, limit: 100, total: leads.length, hasMore: false };
  }

  private _mockGetPipeline(rmId: string): CRMSyncPage<CRMPipelineItem> {
    const clients = getMockClientsForRM(rmId);
    const pipeline: CRMPipelineItem[] = clients.slice(0, 2).map((c, i) => ({
      pipeline_id: `PIPE-${rmId}-${c.client_id}`,
      rm_id: rmId,
      client_id: c.client_id,
      client_name: c.client_name,
      asset_class: 'Equity',
      sub_product: 'PMS',
      amount: 10000000 + i * 5000000,
      status: 'in-progress',
      expected_close_date: new Date(Date.now() + 45 * 86400000).toISOString(),
      created_date: new Date(Date.now() - 15 * 86400000).toISOString(),
      last_updated: new Date().toISOString(),
      probability: 60 + i * 10,
      notes: `PMS onboarding in progress for ${c.client_name}`,
    }));
    return { data: pipeline, page: 1, limit: 100, total: pipeline.length, hasMore: false };
  }
}
