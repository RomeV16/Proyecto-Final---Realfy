import { IsEnum, IsString, IsOptional, MaxLength, Matches } from 'class-validator';
import { IndexType } from '@realfy/shared';

export class CreateIndexDataDto {
  @IsEnum(IndexType)
  indexType!: IndexType;

  @IsString()
  period!: string;

  @IsString()
  @Matches(/^-?\d+(\.\d{1,6})?$/, { message: 'value must be a valid decimal with up to 6 decimal places' })
  value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;
}
