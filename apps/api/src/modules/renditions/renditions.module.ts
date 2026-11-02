import { Module } from '@nestjs/common';
import { RenditionsController } from './renditions.controller';
import { CommissionsController } from './renditions.controller';
import { RenditionsService } from './renditions.service';
import { RenditionPdfService } from './rendition-pdf.service';

@Module({
  controllers: [RenditionsController, CommissionsController],
  providers: [RenditionsService, RenditionPdfService],
  exports: [RenditionsService],
})
export class RenditionsModule {}
