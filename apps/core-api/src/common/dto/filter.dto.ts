import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class FilterDto {
  @ApiPropertyOptional({ description: 'Client tier filter (e.g. ULTRA_HNI, HNI, AFFLUENT)' })
  @IsOptional()
  @IsString()
  tier?: string;

  @ApiPropertyOptional({ description: 'Asset class filter (e.g. EQUITY, DEBT, MF)' })
  @IsOptional()
  @IsString()
  asset_class?: string;

  @ApiPropertyOptional({ description: 'City filter (e.g. Mumbai, Bangalore, Delhi)' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Full-text search term' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Status filter (e.g. PENDING, ACTIVE, CLOSED)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter records from this date (ISO 8601)' })
  @IsOptional()
  @IsString()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Filter records up to this date (ISO 8601)' })
  @IsOptional()
  @IsString()
  date_to?: string;
}
