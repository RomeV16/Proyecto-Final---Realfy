import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { IndexDataModule } from '../index-data/index-data.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [IndexDataModule, AiModule],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
