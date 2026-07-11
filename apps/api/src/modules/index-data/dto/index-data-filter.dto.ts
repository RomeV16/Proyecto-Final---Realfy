import { IsEnum, IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { IndexType } from '@realfy/shared';

export class IndexDataFilterDto {
  @IsOptional()
  @IsEnum(IndexType)
  indexType?: IndexType;

  @IsOptional()
  @IsString()
  periodFrom?: string;

  @IsOptional()
  @IsString()
  periodTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
