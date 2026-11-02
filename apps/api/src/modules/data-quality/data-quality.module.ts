import { Module } from '@nestjs/common';
import { DataQualityController } from './data-quality.controller';
import { DataQualityService } from './data-quality.service';
import { PersonMergeService } from './person-merge.service';

@Module({
  controllers: [DataQualityController],
  providers: [DataQualityService, PersonMergeService],
})
export class DataQualityModule {}
