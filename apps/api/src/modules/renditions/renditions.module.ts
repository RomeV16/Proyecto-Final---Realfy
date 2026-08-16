import { Module } from '@nestjs/common';
import { RenditionsController } from './renditions.controller';
import { CommissionsController } from './renditions.controller';
import { RenditionsService } from './renditions.service';
import { RenditionPdfService } from './rendition-pdf.service';
import { RenditionEmailService } from './rendition-email.service';

@Module({
  controllers: [RenditionsController, CommissionsController],
  providers: [RenditionsService, RenditionPdfService, RenditionEmailService],
  exports: [RenditionsService],
})
export class RenditionsModule {}
