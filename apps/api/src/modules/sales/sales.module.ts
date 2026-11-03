import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { FeesModule } from '../fees/fees.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PropertySalesController, SalesController } from './sales.controller';
import { SalesDepositsService } from './sales-deposits.service';
import { SalesFeesService } from './sales-fees.service';
import { SalesScheduler } from './sales.scheduler';
import { SalesService } from './sales.service';

/** Ventas (D14): operaciones, partes, reservas y señas (con la caja), documentación y honorario. */
@Module({
  imports: [CashModule, FeesModule, TenantsModule],
  controllers: [PropertySalesController, SalesController],
  providers: [SalesService, SalesDepositsService, SalesFeesService, SalesScheduler],
  exports: [SalesService],
})
export class SalesModule {}
