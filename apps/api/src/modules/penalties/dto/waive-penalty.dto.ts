import { IsString, MinLength } from 'class-validator';

export class WaivePenaltyDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
