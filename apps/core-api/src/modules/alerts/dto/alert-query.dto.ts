import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query parameters for GET /api/v1/alerts.
 * All fields are optional — omitting a field means "no filter on that dimension".
 */
export class AlertQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by alert status (NEW | DELIVERED | ACKNOWLEDGED | ACTED_ON | EXPIRED)',
    example: 'NEW',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter by alert type (e.g. birthday, idle_cash, dormant_client)',
    example: 'idle_cash',
  })
  @IsOptional()
  @IsString()
  alert_type?: string;

  @ApiPropertyOptional({
    description: 'Filter by severity level (critical | high | medium | low)',
    example: 'high',
  })
  @IsOptional()
  @IsString()
  severity?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page (max 100)', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}
