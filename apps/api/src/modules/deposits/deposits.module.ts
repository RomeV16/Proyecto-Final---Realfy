import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { LiquidacionesModule } from '../liquidaciones/liquidaciones.module';
import { PenaltiesModule } from '../penalties/penalties.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ContractDepositsController, MoveOutsController } from './deposits.controller';
import { DepositsService } from './deposits.service';
import { MoveOutPdfService } from './move-out-pdf.service';
import { MoveOutService } from './move-out.service';

/** Depósitos de los contratos y liquidación de egreso (D9). */
@Module({
  imports: [CashModule, LiquidacionesModule, PenaltiesModule, TenantsModule],
  controllers: [ContractDepositsController, MoveOutsController],
  providers: [DepositsService, MoveOutService, MoveOutPdfService],
  exports: [DepositsService, MoveOutService],
})
export class DepositsModule {}
