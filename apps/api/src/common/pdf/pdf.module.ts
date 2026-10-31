import { Global, Module } from '@nestjs/common';
import { PdfRendererService } from './pdf-renderer.service';

@Global()
@Module({
  providers: [PdfRendererService],
  exports: [PdfRendererService],
})
export class PdfModule {}
