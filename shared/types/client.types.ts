export interface Client {
  client_id: string;
  rm_id: string;
  client_name: string;
  email: string;
  phone: string;
  pan: string;
  dob: string;
  tier: ClientTier;
  risk_profile: RiskProfile;
  kyc_status: string;
  onboarding_date: string;
  last_interaction: string;
  total_aum: number;
  total_revenue_ytd: number;
  accounts: Account[];
  tags: string[];
}

export interface Account {
  account_id: string;
  account_type: string;
  status: string;
  opening_date: string;
  current_value: number;
}

export interface Holding {
  holding_id: string;
  account_id: string;
  asset_class: AssetClass;
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
}

export interface Portfolio {
  client_id: string;
  rm_id: string;
  holdings: Holding[];
  summary: PortfolioSummary;
}

export interface PortfolioSummary {
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
}

export interface Transaction {
  transaction_id: string;
  client_id: string;
  rm_id: string;
  account_id: string;
  type: 'BUY' | 'SELL' | 'SIP' | 'REDEMPTION' | 'DIVIDEND' | 'SWITCH';
  asset_class: AssetClass;
  instrument_name: string;
  quantity: number;
  price: number;
  amount: number;
  date: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
}

export interface Meeting {
  meeting_id: string;
  rm_id: string;
  client_id: string;
  client_name: string;
  type: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  purpose: string;
  date: string;
  time: string;
  duration_minutes: number;
  notes?: string;
  action_items?: string[];
}

export interface Lead {
  lead_id: string;
  rm_id: string;
  client_id?: string;
  client_name: string;
  source: string;
  product_interest: string;
  estimated_value: number;
  status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'PROPOSAL' | 'WON' | 'LOST';
  created_at: string;
  updated_at: string;
  expiry_date?: string;
}

export type ClientTier = 'DIAMOND' | 'BLACK' | 'PLATINUM' | 'GOLD' | 'SILVER' | 'BRONZE' | 'BLUE' | 'NA';
export type AssetClass = 'EQ' | 'FI' | 'MP' | 'LI' | 'CM' | 'RE';
export type RiskProfile = 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  EQ: 'Equity',
  FI: 'Fixed Income',
  MP: 'Mutual Funds',
  LI: 'Life Insurance',
  CM: 'Commodity',
  RE: 'Real Estate',
};

export const CLIENT_TIER_ORDER: Record<ClientTier, number> = {
  DIAMOND: 1, BLACK: 2, PLATINUM: 3, GOLD: 4,
  SILVER: 5, BRONZE: 6, BLUE: 7, NA: 8,
};
