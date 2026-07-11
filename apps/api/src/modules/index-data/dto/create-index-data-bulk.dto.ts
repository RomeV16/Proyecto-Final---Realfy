import { IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateIndexDataDto } from './create-index-data.dto';

export class CreateIndexDataBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateIndexDataDto)
  items!: CreateIndexDataDto[];
}
