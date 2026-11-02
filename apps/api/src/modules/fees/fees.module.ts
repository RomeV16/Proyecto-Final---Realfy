import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { CashModule } from '../cash/cash.module';
import { FeesController, StaffCommissionsController } from './fees.controller';
import { FeesService } from './fees.service';
import { FeeProposalService } from './fee-proposal.service';
import { FeePaymentsService } from './fee-payments.service';

/** Honorarios, cuotas, coorretaje y comisiones del personal (D10). */
@Module({
  imports: [TenantsModule, CashModule],
  controllers: [FeesController, StaffCommissionsController],
  providers: [FeesService, FeeProposalService, FeePaymentsService],
  exports: [FeesService],
})
export class FeesModule {}
