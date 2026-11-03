import { Module } from '@nestjs/common';
import { LiquidacionesController } from './liquidaciones.controller';
import { LiquidacionesService } from './liquidaciones.service';
import { PdfService } from './pdf.service';
import { LiquidacionesScheduler } from './liquidaciones.scheduler';
import { TenantsModule } from '../tenants/tenants.module';
import { IndexDataModule } from '../index-data/index-data.module';
import { ServicesModule } from '../services/services.module';
import { PenaltiesModule } from '../penalties/penalties.module';
import { ChargesModule } from '../charges/charges.module';
import { CashModule } from '../cash/cash.module';

@Module({
  imports: [TenantsModule, IndexDataModule, ServicesModule, PenaltiesModule, ChargesModule, CashModule],
  controllers: [LiquidacionesController],
  providers: [
    LiquidacionesService,
    PdfService,
    LiquidacionesScheduler,
  ],
  exports: [LiquidacionesService],
})
export class LiquidacionesModule {}
