import { Module } from '@nestjs/common';
import { LiquidacionesController } from './liquidaciones.controller';
import { LiquidacionesService } from './liquidaciones.service';
import { PdfService } from './pdf.service';
import { EmailService } from './email.service';

@Module({
  controllers: [LiquidacionesController],
  providers: [
    LiquidacionesService,
    PdfService,
    EmailService,
  ],
  exports: [LiquidacionesService],
})
export class LiquidacionesModule {}
