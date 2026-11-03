import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import {
  CashMovementsController,
  CompensationsController,
  CustodyController,
  FinancialAccountsController,
  ReceiptsController,
} from './cash.controller';
import { CashService } from './cash.service';
import { CompensationsService } from './compensations.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { ReceiptsService } from './receipts.service';

/** Caja y cobros: cuentas, libro, custodia, compensaciones y recibos (ADR-0012). */
@Module({
  imports: [TenantsModule],
  controllers: [
    FinancialAccountsController,
    CashMovementsController,
    CustodyController,
    CompensationsController,
    ReceiptsController,
  ],
  providers: [CashService, CompensationsService, PaymentSettlementService, ReceiptsService],
  exports: [CashService, PaymentSettlementService, ReceiptsService],
})
export class CashModule {}
