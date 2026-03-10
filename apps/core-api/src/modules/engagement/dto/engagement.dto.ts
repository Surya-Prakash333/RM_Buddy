import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query parameters for GET /api/v1/engagement/data.
 * `period` is in YYYY-MM format (e.g. "2024-01") or omitted to default to current month.
 */
export class EngagementDataQueryDto {
  @ApiPropertyOptional({
    description: 'Period in YYYY-MM format. Defaults to current month.',
    example: '2024-01',
  })
  @IsOptional()
  @IsString()
  period?: string;
}

/**
 * Query parameters for GET /api/v1/engagement/trend.
 * `days` is the number of trailing days to include (default 30, max 90).
 */
export class EngagementTrendQueryDto {
  @ApiPropertyOptional({
    description: 'Number of trailing days to compute daily scores for',
    default: 30,
    minimum: 1,
    maximum: 90,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  @Type(() => Number)
  days?: number = 30;
}

/**
 * Full engagement snapshot for a single RM + period.
 */
export interface EngagementData {
  rm_id: string;
  period: string;

  // Login patterns (derived from rm_sessions)
  login_days: number;
  total_sessions: number;
  avg_session_duration_min: number;
  longest_session_min: number;
  login_streak_days: number;
  last_login_at: string;

  // CRM usage (derived from audit_trail)
  crm_actions_total: number;
  avg_daily_crm_actions: number;
  pages_visited: Record<string, number>;

  // Consistency scoring
  consistency_score: number;
  consistency_trend: 'improving' | 'stable' | 'declining';

  // Data quality flag — true when underlying collections have no records
  is_estimated: boolean;
}

/**
 * A single daily data-point returned by getEngagementTrend().
 */
export interface EngagementTrendPoint {
  date: string;           // YYYY-MM-DD
  login: boolean;
  session_count: number;
  crm_actions: number;
  daily_score: number;
}
