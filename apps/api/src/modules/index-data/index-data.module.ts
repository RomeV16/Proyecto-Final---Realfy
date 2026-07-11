import { Module } from '@nestjs/common';
import { IndexDataController } from './index-data.controller';
import { IndexDataService } from './index-data.service';
import { ContractAdjustmentService } from './contract-adjustment.service';

@Module({
  controllers: [IndexDataController],
  providers: [IndexDataService, ContractAdjustmentService],
  exports: [IndexDataService, ContractAdjustmentService],
})
export class IndexDataModule {}
