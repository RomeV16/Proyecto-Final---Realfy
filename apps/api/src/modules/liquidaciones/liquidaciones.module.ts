import { Module } from '@nestjs/common';
import { LiquidacionesController } from './liquidaciones.controller';
import { LiquidacionesService } from './liquidaciones.service';
import { PdfService } from './pdf.service';
import { EmailService } from './email.service';
import { LiquidacionesScheduler } from './liquidaciones.scheduler';
import { TenantsModule } from '../tenants/tenants.module';
import { IndexDataModule } from '../index-data/index-data.module';
import { ServicesModule } from '../services/services.module';

@Module({
  imports: [TenantsModule, IndexDataModule, ServicesModule],
  controllers: [LiquidacionesController],
  providers: [
    LiquidacionesService,
    PdfService,
    EmailService,
    LiquidacionesScheduler,
  ],
  exports: [LiquidacionesService],
})
export class LiquidacionesModule {}
