import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractLessorsService } from './contract-lessors.service';
import { IndexDataModule } from '../index-data/index-data.module';
import { AiModule } from '../ai/ai.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ContractRulesService } from './contract-rules.service';

@Module({
  imports: [IndexDataModule, AiModule, TenantsModule],
  controllers: [ContractsController],
  providers: [ContractsService, ContractLessorsService, ContractRulesService],
  exports: [ContractsService],
})
export class ContractsModule {}
