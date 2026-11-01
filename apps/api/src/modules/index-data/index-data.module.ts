import { Module } from '@nestjs/common';
import { IndexDataController } from './index-data.controller';
import { IndexDataService } from './index-data.service';
import { IndexScraperService } from './index-scraper.service';
import { IndexScraperScheduler } from './index-scraper.scheduler';
import { ContractAdjustmentService } from './contract-adjustment.service';
import { AdjustmentTrueUpService } from './adjustment-trueup.service';
import { AdjustmentBatchService } from './adjustment-batch.service';
import { AdjustmentsScheduler } from './adjustments.scheduler';
import { AdjustmentsController } from './adjustments.controller';

@Module({
  controllers: [IndexDataController, AdjustmentsController],
  providers: [
    IndexDataService,
    IndexScraperService,
    IndexScraperScheduler,
    ContractAdjustmentService,
    AdjustmentTrueUpService,
    AdjustmentBatchService,
    AdjustmentsScheduler,
  ],
  exports: [IndexDataService, IndexScraperService, ContractAdjustmentService],
})
export class IndexDataModule {}
