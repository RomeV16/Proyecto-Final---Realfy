import {
  IsString,
  IsInt,
  Min,
  ValidateNested,
  IsEnum,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum PreviewPenaltyMode {
  DailyFixed = 'daily_fixed',
  DailyPercent = 'daily_percent',
  CompoundPercent = 'compound_percent',
}

const DECIMAL_STRING_PATTERN = /^\d+(\.\d+)?$/;

export class PreviewPenaltyConfigDto {
  @IsEnum(PreviewPenaltyMode)
  mode!: PreviewPenaltyMode;

  @IsString()
  @Matches(DECIMAL_STRING_PATTERN, {
    message: 'value must be a non-negative decimal string (e.g. "0.001")',
  })
  value!: string;

  @IsInt()
  @Min(0)
  graceDays!: number;

  @IsString()
  @Matches(DECIMAL_STRING_PATTERN, {
    message: 'maxMultiplier must be a non-negative decimal string (e.g. "2.0")',
  })
  maxMultiplier!: string;
}

export class PreviewPenaltyDto {
  @IsString()
  @Matches(DECIMAL_STRING_PATTERN, {
    message: 'debt must be a non-negative decimal string',
  })
  debt!: string;

  @IsInt()
  @Min(0)
  daysOverdue!: number;

  @ValidateNested()
  @Type(() => PreviewPenaltyConfigDto)
  config!: PreviewPenaltyConfigDto;
}
