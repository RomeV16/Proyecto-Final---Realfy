import { Module } from '@nestjs/common';
import { IndexDataController } from './index-data.controller';
import { IndexDataService } from './index-data.service';
import { IndexScraperService } from './index-scraper.service';
import { IndexScraperScheduler } from './index-scraper.scheduler';
import { ContractAdjustmentService } from './contract-adjustment.service';

@Module({
  controllers: [IndexDataController],
  providers: [
    IndexDataService,
    IndexScraperService,
    IndexScraperScheduler,
    ContractAdjustmentService,
  ],
  exports: [IndexDataService, IndexScraperService, ContractAdjustmentService],
})
export class IndexDataModule {}
