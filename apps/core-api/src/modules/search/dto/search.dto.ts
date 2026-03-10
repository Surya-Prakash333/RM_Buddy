import { IsString, IsOptional, IsNumber, MinLength, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchQueryDto {
  @ApiProperty({ description: 'Search query string (min 2 characters)', example: 'Sharma' })
  @IsString()
  @MinLength(2)
  q!: string;

  @ApiPropertyOptional({ description: 'Maximum number of results to return (max 50)', example: 10 })
  @IsOptional()
  @IsNumber()
  @Max(50)
  @Type(() => Number)
  limit?: number;
}
