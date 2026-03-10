// ============================================================
// API Response Wrapper — ALL endpoints return this shape
// ============================================================
export interface APIResponse<T> {
  status: 'success' | 'error';
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  meta?: PaginationMeta;
  timestamp: string; // ISO 8601
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
}

// ============================================================
// RM Identity (Passed in X-RM-Identity header by Gateway)
// ============================================================
export interface RMIdentity {
  rm_id: string;
  rm_name: string;
  rm_code: string;
  rm_email: string;
  rm_branch: string;
  rm_region: string;
  role: 'RM' | 'BM' | 'ADMIN';
  client_count: number;
  session_id: string;
  token_expires: string; // ISO 8601
}

// ============================================================
// Filter & Query Params
// ============================================================
export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
}

export interface FilterParams {
  tier?: string;
  asset_class?: string;
  date_range?: DateRange;
  search?: string;
  status?: string;
}

export interface PaginationParams {
  page: number;    // 1-based
  limit: number;   // default 20, max 100
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}
