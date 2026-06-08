import {
  IsEnum,
  IsString,
  Matches,
  IsInt,
  Min,
} from 'class-validator';

export enum PenaltyMode {
  DailyFixed = 'daily_fixed',
  DailyPercent = 'daily_percent',
  CompoundPercent = 'compound_percent',
}

/** Decimal-as-string: optional leading sign, digits, optional decimal part. */
const DECIMAL_STRING_PATTERN = /^\d+(\.\d+)?$/;

export class UpdatePenaltyConfigDto {
  @IsEnum(PenaltyMode)
  mode!: PenaltyMode;

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
