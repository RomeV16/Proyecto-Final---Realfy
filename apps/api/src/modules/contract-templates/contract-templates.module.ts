import { Module } from '@nestjs/common';
import { ContractTemplatesController } from './contract-templates.controller';
import { ContractTemplatesService } from './contract-templates.service';
import { ContractPdfService } from './contract-pdf.service';
import { ContractDocxService } from './contract-docx.service';
import { ContractsModule } from '../contracts/contracts.module';

@Module({
  imports: [ContractsModule],
  controllers: [ContractTemplatesController],
  providers: [
    ContractTemplatesService,
    ContractPdfService,
    ContractDocxService,
  ],
  exports: [ContractTemplatesService],
})
export class ContractTemplatesModule {}
